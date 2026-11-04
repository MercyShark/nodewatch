// Time series on SQLite: raw 15 s samples kept 48 h, 5-minute rollups (avg/max/min) kept 30 d.
import type { Range, Series, SeriesPoint } from "@nodewatch/shared";
import type { DB } from "../db/index.js";

export const RAW_RETENTION_MS = 48 * 3600_000;
export const ROLLUP_RETENTION_MS = 30 * 24 * 3600_000;
export const ROLLUP_MS = 5 * 60_000;

export const RANGE_MS: Record<Range, number> = {
  "1h": 3600_000,
  "6h": 6 * 3600_000,
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
};

export function isRange(v: unknown): v is Range {
  return typeof v === "string" && v in RANGE_MS;
}

export type Labels = Record<string, string>;

/** Canonical label encoding: sorted keys, JSON. Same labels always give the same string. */
export function encodeLabels(labels: Labels = {}): string {
  const keys = Object.keys(labels).sort();
  const o: Labels = {};
  for (const k of keys) o[k] = labels[k]!;
  return JSON.stringify(o);
}

interface Pending {
  ts: number;
  metric: string;
  labels: string;
  value: number;
}

export interface RangeQuery {
  metric: string;
  labels?: Labels;
  range: Range;
  agg?: "avg" | "max" | "min";
  now?: number;
  /** Bucket size for downsampling raw data (ms). Defaults by range. */
  stepMs?: number;
}

export class Tsdb {
  private buf: Pending[] = [];
  private readonly insert;
  constructor(private readonly db: DB) {
    this.insert = db.prepare("INSERT INTO samples(ts, metric, labels, value) VALUES (?, ?, ?, ?)");
  }

  /** Queue one sample. Non-finite values are dropped. */
  record(metric: string, value: number | null | undefined, labels: Labels = {}, ts = Date.now()): void {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    this.buf.push({ ts, metric, labels: encodeLabels(labels), value });
    if (this.buf.length > 20_000) this.flush();
  }

  /** Write queued samples in one transaction. */
  flush(): number {
    if (this.buf.length === 0) return 0;
    const rows = this.buf;
    this.buf = [];
    const tx = this.db.transaction((items: Pending[]) => {
      for (const r of items) this.insert.run(r.ts, r.metric, r.labels, r.value);
    });
    tx(rows);
    return rows.length;
  }

  /** Build 5-minute rollups for complete buckets not yet rolled up, then apply retention. */
  rollupAndRetain(now = Date.now()): { rolled: number; deletedRaw: number; deletedRollups: number } {
    this.flush();
    const lastComplete = Math.floor(now / ROLLUP_MS) * ROLLUP_MS; // exclusive end
    const maxRolled = (this.db.prepare("SELECT MAX(ts) AS m FROM rollups_5m").get() as { m: number | null }).m;
    const from = Math.max(lastComplete - RAW_RETENTION_MS, (maxRolled ?? 0) - ROLLUP_MS);
    const res = this.db
      .prepare(
        `INSERT INTO rollups_5m(ts, metric, labels, avg, max, min, count)
         SELECT (ts / ${ROLLUP_MS}) * ${ROLLUP_MS} AS b, metric, labels, AVG(value), MAX(value), MIN(value), COUNT(*)
         FROM samples WHERE ts >= ? AND ts < ?
         GROUP BY b, metric, labels
         ON CONFLICT(metric, labels, ts) DO UPDATE SET avg = excluded.avg, max = excluded.max, min = excluded.min, count = excluded.count`,
      )
      .run(from, lastComplete);
    const deletedRaw = this.db.prepare("DELETE FROM samples WHERE ts < ?").run(now - RAW_RETENTION_MS).changes;
    const deletedRollups = this.db.prepare("DELETE FROM rollups_5m WHERE ts < ?").run(now - ROLLUP_RETENTION_MS).changes;
    return { rolled: res.changes, deletedRaw, deletedRollups };
  }

  /** Default bucket size so a chart gets ~240-360 points. */
  static stepFor(range: Range): number {
    switch (range) {
      case "1h":
        return 15_000;
      case "6h":
        return 60_000;
      case "24h":
        return 5 * 60_000;
      case "7d":
        return 30 * 60_000;
      case "30d":
        return 2 * 3600_000;
    }
  }

  /** Range query: ≤ 6 h reads raw samples, longer ranges read rollups. */
  query(q: RangeQuery): SeriesPoint[] {
    const now = q.now ?? Date.now();
    const span = RANGE_MS[q.range];
    const since = now - span;
    const step = Math.max(q.stepMs ?? Tsdb.stepFor(q.range), 1000);
    const agg = q.agg ?? "avg";
    const labels = encodeLabels(q.labels);
    const useRaw = span <= 6 * 3600_000;
    let rows: { t: number; v: number }[];
    if (useRaw) {
      this.flush();
      const fn = agg === "avg" ? "AVG" : agg === "max" ? "MAX" : "MIN";
      rows = this.db
        .prepare(
          `SELECT (ts / ${step}) * ${step} AS t, ${fn}(value) AS v FROM samples
           WHERE metric = ? AND labels = ? AND ts >= ? GROUP BY t ORDER BY t`,
        )
        .all(q.metric, labels, since) as { t: number; v: number }[];
    } else {
      const col = agg;
      const fn = agg === "avg" ? "AVG" : agg === "max" ? "MAX" : "MIN";
      rows = this.db
        .prepare(
          `SELECT (ts / ${step}) * ${step} AS t, ${fn}(${col}) AS v FROM rollups_5m
           WHERE metric = ? AND labels = ? AND ts >= ? GROUP BY t ORDER BY t`,
        )
        .all(q.metric, labels, since) as { t: number; v: number }[];
      // Rollups lag up to 5 minutes behind; top up with the newest raw samples.
      const lastT = rows.length ? rows[rows.length - 1]!.t + step : since;
      const raw = this.db
        .prepare(
          `SELECT (ts / ${step}) * ${step} AS t, ${fn}(value) AS v FROM samples
           WHERE metric = ? AND labels = ? AND ts >= ? GROUP BY t ORDER BY t`,
        )
        .all(q.metric, labels, Math.max(lastT, now - RAW_RETENTION_MS)) as { t: number; v: number }[];
      rows = rows.concat(raw.filter((r) => r.t >= lastT));
    }
    return rows.map((r) => ({ t: r.t, v: round(r.v) }));
  }

  series(metric: string, range: Range, labels: Labels = {}, agg: "avg" | "max" | "min" = "avg", now?: number): Series {
    return { metric, labels, points: this.query({ metric, labels, range, agg, now }) };
  }

  /** Distinct label sets recorded for a metric in the last `sinceMs`. */
  labelSets(metric: string, sinceMs: number, now = Date.now()): Labels[] {
    this.flush();
    const raw = this.db
      .prepare("SELECT DISTINCT labels FROM samples WHERE metric = ? AND ts >= ?")
      .all(metric, now - Math.min(sinceMs, RAW_RETENTION_MS)) as { labels: string }[];
    const set = new Set(raw.map((r) => r.labels));
    if (sinceMs > RAW_RETENTION_MS) {
      const roll = this.db
        .prepare("SELECT DISTINCT labels FROM rollups_5m WHERE metric = ? AND ts >= ?")
        .all(metric, now - sinceMs) as { labels: string }[];
      for (const r of roll) set.add(r.labels);
    }
    return [...set].map((s) => JSON.parse(s) as Labels);
  }

  /** Sum of values for a metric+labels over a window (counters recorded as per-interval deltas). */
  sum(metric: string, labels: Labels, sinceMs: number, now = Date.now()): number {
    this.flush();
    const l = encodeLabels(labels);
    if (sinceMs <= RAW_RETENTION_MS) {
      const r = this.db
        .prepare("SELECT COALESCE(SUM(value), 0) AS s FROM samples WHERE metric = ? AND labels = ? AND ts >= ?")
        .get(metric, l, now - sinceMs) as { s: number };
      return r.s;
    }
    const r = this.db
      .prepare("SELECT COALESCE(SUM(avg * count), 0) AS s FROM rollups_5m WHERE metric = ? AND labels = ? AND ts >= ?")
      .get(metric, l, now - sinceMs) as { s: number };
    return r.s;
  }

  /** Raw values in a window (for percentiles / z-scores). */
  values(metric: string, labels: Labels, sinceMs: number, now = Date.now()): number[] {
    this.flush();
    const rows = this.db
      .prepare("SELECT value FROM samples WHERE metric = ? AND labels = ? AND ts >= ? ORDER BY ts")
      .all(metric, encodeLabels(labels), now - sinceMs) as { value: number }[];
    return rows.map((r) => r.value);
  }

  latest(metric: string, labels: Labels = {}): { ts: number; value: number } | null {
    this.flush();
    const r = this.db
      .prepare("SELECT ts, value FROM samples WHERE metric = ? AND labels = ? ORDER BY ts DESC LIMIT 1")
      .get(metric, encodeLabels(labels)) as { ts: number; value: number } | undefined;
    return r ?? null;
  }
}

function round(v: number): number {
  return Math.abs(v) >= 1000 ? Math.round(v) : Math.round(v * 1000) / 1000;
}
