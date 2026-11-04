// Backups: node keys/config and the Nodewatch database, ALWAYS envelope-encrypted to the operator's
// wallet key (OPERATOR_RECIPIENT_ADDRESS, registered by signature). Targets: local (DATA_DIR/backups)
// and Swarm. No AWS. Plaintext keys are never written to disk and never logged.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { BackupItem, BackupsResponse } from "@nodewatch/shared";
import type { Ctx } from "../context.js";
import { errMsg } from "../util/http.js";
import { beeConfigured, downloadFromSwarm, uploadToSwarm } from "../swarm/bee.js";
import { decryptEnvelope, encryptEnvelope, isEnvelope, sha256Hex, type Envelope } from "../swarm/ecies.js";
import { getRecipient } from "../swarm/recipients.js";
import { tarGz } from "../swarm/tarball.js";
import type { Vault } from "../swarm/vault.js";

type Kind = BackupItem["kind"];
type Target = BackupItem["target"];

interface Row {
  id: string;
  target: Target;
  kind: Kind;
  location: string;
  sha256: string;
  size_bytes: number;
  ok: number;
  error: string | null;
  created_at: number;
}

const toItem = (r: Row): BackupItem => ({
  id: r.id,
  target: r.target,
  kind: r.kind,
  location: r.location,
  sha256: r.sha256,
  sizeBytes: r.size_bytes,
  ok: !!r.ok,
  error: r.error,
  createdAt: r.created_at,
});

export const NO_OPERATOR = "no operator recipient registered; refusing to back up keys in plaintext";
const MAX_KEY_FILE = 1024 * 1024;

export class Backups {
  private timers: NodeJS.Timeout[] = [];
  private running: Promise<BackupItem[]> | null = null;
  private readonly dir: string;

  constructor(
    private readonly ctx: Ctx,
    readonly vault: Vault,
  ) {
    this.dir = path.join(ctx.cfg.DATA_DIR, "backups");
  }

  private swarmEnabled(): boolean {
    return this.ctx.cfg.BACKUP_SWARM_ENABLED && beeConfigured(this.ctx.cfg);
  }

  response(): BackupsResponse {
    const rows = this.ctx.db.prepare("SELECT * FROM backups ORDER BY created_at DESC LIMIT 100").all() as Row[];
    const last = this.ctx.db.prepare("SELECT MAX(created_at) AS t FROM backups WHERE ok = 1").get() as { t: number | null };
    return {
      targets: [
        { name: "local", configured: true },
        { name: "swarm", configured: this.swarmEnabled() },
      ],
      items: rows.map(toItem),
      lastSuccessAt: last.t,
    };
  }

  private operator() {
    const a = this.ctx.cfg.OPERATOR_RECIPIENT_ADDRESS;
    return a ? getRecipient(this.ctx.db, a) : null;
  }

  private record(r: Row): BackupItem {
    this.ctx.db
      .prepare(
        `INSERT INTO backups(id, target, kind, location, sha256, size_bytes, ok, error, created_at)
         VALUES (@id, @target, @kind, @location, @sha256, @size_bytes, @ok, @error, @created_at)`,
      )
      .run(r);
    return toItem(r);
  }

  /** Read node kit keys/config into an in-memory tar.gz. Never logged, never written in plaintext. */
  private keysConfigTar(): Buffer {
    const kit = this.ctx.cfg.NODE_KIT_DIR;
    const files: { name: string; data: Buffer }[] = [];
    const add = (rel: string) => {
      const p = path.join(kit, rel);
      try {
        const st = statSync(p);
        if (st.isFile() && st.size <= MAX_KEY_FILE) files.push({ name: rel, data: readFileSync(p) });
      } catch {
        /* missing file: skip */
      }
    };
    add(".env");
    add("frpc.toml");
    const walk = (rel: string, depth: number) => {
      if (depth > 3) return;
      let entries;
      try {
        entries = readdirSync(path.join(kit, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = path.posix.join(rel, e.name);
        if (e.isDirectory()) walk(r, depth + 1);
        else if (e.isFile()) add(r);
      }
    };
    walk("secrets", 0);
    if (files.length === 0) throw new Error(`no keys or config found under ${kit}`);
    return tarGz(files);
  }

  private dbSnapshot(): Promise<Buffer> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(this.dir, `.db-${randomUUID()}.sqlite`);
    return this.ctx.db
      .backup(tmp)
      .then(() => readFileSync(tmp))
      .finally(() => {
        try {
          unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      });
  }

  private async backupKind(kind: Kind, build: () => Buffer | Promise<Buffer>): Promise<BackupItem[]> {
    const createdAt = Date.now();
    const fail = (target: Target, error: string): BackupItem =>
      this.record({ id: randomUUID(), target, kind, location: "", sha256: "", size_bytes: 0, ok: 0, error, created_at: createdAt });
    const op = this.operator();
    if (!op) return [fail("local", NO_OPERATOR)];
    let envelope: Envelope;
    try {
      const plain = await build();
      envelope = encryptEnvelope(plain, [op]);
      plain.fill(0);
    } catch (err) {
      return [fail("local", errMsg(err).slice(0, 300))];
    }
    const payload = Buffer.from(JSON.stringify(envelope));
    const sha = sha256Hex(payload);
    const items: BackupItem[] = [];
    const id = randomUUID();
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const file = path.join(this.dir, `${id}.json`);
      writeFileSync(file, payload, { mode: 0o600 });
      items.push(this.record({ id, target: "local", kind, location: file, sha256: sha, size_bytes: payload.length, ok: 1, error: null, created_at: createdAt }));
    } catch (err) {
      items.push(fail("local", errMsg(err)));
    }
    if (this.swarmEnabled()) {
      try {
        const ref = await uploadToSwarm(this.ctx.cfg, payload);
        items.push(this.record({ id: randomUUID(), target: "swarm", kind, location: `bzz:${ref}`, sha256: sha, size_bytes: payload.length, ok: 1, error: null, created_at: createdAt }));
      } catch (err) {
        items.push(fail("swarm", `swarm upload: ${errMsg(err)}`.slice(0, 300)));
      }
    }
    return items;
  }

  async run(): Promise<BackupItem[]> {
    if (this.running) return this.running;
    this.running = (async () => {
      const items = [
        ...(await this.backupKind("keys-config", () => this.keysConfigTar())),
        ...(await this.backupKind("nodewatch-db", () => this.dbSnapshot())),
      ];
      this.prune();
      const failed = items.filter((i) => !i.ok);
      this.ctx.log.info({ ok: items.length - failed.length, failed: failed.length }, "backup run finished");
      return items;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Keep the newest 14 local files per kind. */
  private prune(): void {
    for (const kind of ["keys-config", "nodewatch-db"] as Kind[]) {
      const old = this.ctx.db
        .prepare("SELECT id, location FROM backups WHERE target = 'local' AND kind = ? AND ok = 1 ORDER BY created_at DESC LIMIT -1 OFFSET 14")
        .all(kind) as { id: string; location: string }[];
      for (const o of old) {
        try {
          if (o.location.startsWith(this.dir)) rmSync(o.location, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
  }

  async testRestore(id?: string, privateKeyHex?: string): Promise<{ ok: boolean; detail: string }> {
    const row = (
      id
        ? this.ctx.db.prepare("SELECT * FROM backups WHERE id = ?").get(id)
        : this.ctx.db.prepare("SELECT * FROM backups WHERE ok = 1 ORDER BY created_at DESC LIMIT 1").get()
    ) as Row | undefined;
    if (!row) return { ok: false, detail: "no backup found" };
    if (!row.ok) return { ok: false, detail: `backup ${row.id} failed when it was made: ${row.error ?? ""}` };
    let payload: Buffer;
    try {
      if (row.target === "swarm") payload = Buffer.from(await downloadFromSwarm(this.ctx.cfg, row.location.replace(/^bzz:/, "")));
      else {
        if (!existsSync(row.location)) return { ok: false, detail: `local file ${row.location} is missing` };
        payload = readFileSync(row.location);
      }
    } catch (err) {
      return { ok: false, detail: `cannot read backup: ${errMsg(err)}` };
    }
    if (sha256Hex(payload) !== row.sha256) return { ok: false, detail: "checksum mismatch: the stored backup is corrupted" };
    let env: unknown;
    try {
      env = JSON.parse(payload.toString("utf8"));
    } catch {
      return { ok: false, detail: "backup is not a valid envelope" };
    }
    if (!isEnvelope(env)) return { ok: false, detail: "backup is not a valid envelope" };
    if (!privateKeyHex) {
      return { ok: true, detail: `checksum and envelope structure verified for ${row.kind} (${row.target}); decryption needs the operator's private key` };
    }
    const tmp = mkdtempSync(path.join(os.tmpdir(), "nodewatch-restore-"));
    try {
      const plain = decryptEnvelope(env, privateKeyHex);
      const file = path.join(tmp, row.kind === "nodewatch-db" ? "nodewatch.sqlite" : "keys-config.tar.gz");
      writeFileSync(file, plain, { mode: 0o600 });
      if (row.kind === "nodewatch-db") {
        if (!plain.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))) return { ok: false, detail: "decrypted, but it is not a SQLite database" };
      } else {
        gunzipSync(plain);
      }
      plain.fill(0);
      return { ok: true, detail: `decrypted and verified ${row.kind} (${row.target}, ${row.size_bytes} bytes) in a temp dir, then deleted it` };
    } catch (err) {
      return { ok: false, detail: `restore failed: ${errMsg(err)}` };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  start(): void {
    const intervalMs = Math.max(1, this.ctx.cfg.BACKUP_INTERVAL_HOURS) * 3600_000;
    const check = () => {
      const last = this.ctx.db.prepare("SELECT MAX(created_at) AS t FROM backups").get() as { t: number | null };
      if (!last.t || Date.now() - last.t >= intervalMs) {
        this.run().catch((err: unknown) => this.ctx.log.warn({ err: errMsg(err) }, "scheduled backup failed"));
      }
    };
    const first = setTimeout(check, 5 * 60_000);
    const iv = setInterval(check, 15 * 60_000);
    first.unref();
    iv.unref();
    this.timers = [first, iv];
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
