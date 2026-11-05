// SQLite (better-sqlite3, WAL). Raw SQL with an ordered list of migrations.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  // 1: core schema (CLAUDE.md §5.13)
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    address TEXT,
    method TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE siwe_nonces (
    nonce TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE samples (ts INTEGER NOT NULL, metric TEXT NOT NULL, labels TEXT NOT NULL, value REAL NOT NULL);
  CREATE INDEX samples_mlt ON samples(metric, labels, ts);
  CREATE INDEX samples_ts ON samples(ts);
  CREATE TABLE rollups_5m (
    ts INTEGER NOT NULL, metric TEXT NOT NULL, labels TEXT NOT NULL,
    avg REAL NOT NULL, max REAL NOT NULL, min REAL NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (metric, labels, ts)
  );
  CREATE INDEX rollups_ts ON rollups_5m(ts);
  CREATE TABLE disk_samples (
    ts INTEGER PRIMARY KEY, used_bytes REAL, free_bytes REAL, total_bytes REAL, el_bytes REAL, cl_bytes REAL
  );
  CREATE TABLE verdicts (
    ts INTEGER NOT NULL, code TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, fix TEXT
  );
  CREATE INDEX verdicts_ts ON verdicts(ts);
  CREATE TABLE alerts_state (
    key TEXT PRIMARY KEY, rule TEXT NOT NULL, node TEXT NOT NULL, state TEXT NOT NULL, severity TEXT NOT NULL,
    summary TEXT NOT NULL, pending_since INTEGER, started_at INTEGER, resolved_at INTEGER, event_id TEXT, updated_at INTEGER NOT NULL
  );
  CREATE TABLE alert_events (
    id TEXT PRIMARY KEY, rule TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL,
    started_at INTEGER NOT NULL, resolved_at INTEGER
  );
  CREATE INDEX alert_events_started ON alert_events(started_at);
  CREATE TABLE alerts_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, channel TEXT NOT NULL, kind TEXT NOT NULL,
    rules TEXT NOT NULL, ok INTEGER NOT NULL, attempts INTEGER NOT NULL, error TEXT
  );
  CREATE TABLE silences (
    id TEXT PRIMARY KEY, rule TEXT, until INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE heartbeats_sent (
    ts INTEGER NOT NULL, ok INTEGER NOT NULL, tx_hash TEXT, block INTEGER, entity_key TEXT, expires_at_block INTEGER, error TEXT
  );
  CREATE TABLE bench_runs (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, target TEXT NOT NULL, sizes TEXT NOT NULL, started_at INTEGER NOT NULL,
    finished_at INTEGER, progress REAL NOT NULL DEFAULT 0, message TEXT, scaling TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE bench_results (
    run_id TEXT NOT NULL, shape_id TEXT NOT NULL, shape_text_enc TEXT NOT NULL, size INTEGER NOT NULL,
    p50 REAL NOT NULL, p95 REAL NOT NULL, p99 REAL NOT NULL, rows INTEGER NOT NULL, errors INTEGER NOT NULL, bytes INTEGER NOT NULL,
    PRIMARY KEY (run_id, shape_id, size)
  );
  CREATE TABLE bundles (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, scheme TEXT NOT NULL, recipient TEXT, swarm_ref TEXT, entity_key TEXT,
    sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, local_path TEXT
  );
  CREATE TABLE recipients (
    address TEXT PRIMARY KEY, public_key TEXT NOT NULL, label TEXT NOT NULL, added_at INTEGER NOT NULL
  );
  CREATE TABLE backups (
    id TEXT PRIMARY KEY, target TEXT NOT NULL, kind TEXT NOT NULL, location TEXT NOT NULL, sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, ok INTEGER NOT NULL, error TEXT, created_at INTEGER NOT NULL
  );
  `,
  // 2: slow-query finder detail: per-sample latency stats and run metadata (seeding/measure timings, client)
  `
  ALTER TABLE bench_results ADD COLUMN stats TEXT;
  ALTER TABLE bench_runs ADD COLUMN meta TEXT;
  `,
  // 3: autopilot action log
  `
  CREATE TABLE autopilot_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, action TEXT NOT NULL, ok INTEGER NOT NULL,
    message TEXT NOT NULL, tx_hash TEXT
  );
  CREATE INDEX autopilot_log_ts ON autopilot_log(ts);
  `,
];

export function openDb(dataDir: string, file = "nodewatch.sqlite"): DB {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(file === ":memory:" ? ":memory:" : path.join(dataDir, file));
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    const tx = db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.pragma(`user_version = ${i + 1}`);
    });
    tx();
  }
}

export function getSetting<T>(db: DB, key: string, def: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return def;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return def;
  }
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    JSON.stringify(value),
  );
}
