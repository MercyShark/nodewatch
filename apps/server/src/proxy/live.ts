// Live queries: every request the proxy sees. A ring of recent requests feeds the live feed (SSE "rpc" event,
// batched once a second); every request is also written to rpc_requests_log (48 h, capped) with its text, so the
// feed, the slowest list and the per-method errors survive restarts; per-shape counters live in rpc_shapes with the
// latest raw example. Text is the operator's own node traffic, kept on the operator's disk; viewers never receive it
// (the stream and the API strip it per role). Nothing here can break forwarding: every call is wrapped.
import type { MethodError, QueryShapeRow, RecentRequest, SlowRequest } from "@nodewatch/shared";
import type { Ctx } from "../context.js";
import { normalizeShape, shapeId } from "./shape.js";

const RING = 500;
const RESERVOIR = 256;
const MAX_SHAPES = 2000;
const LOG_RETENTION_MS = 48 * 3600_000;
const LOG_MAX_ROWS = 100_000;
const TEXT_MAX = 2000;
/** Same line as the slow-query finder: a read over 250 ms is slow. */
export const SLOW_MS = 250;

interface ShapeAcc {
  method: string;
  shape: string;
  sample: string;
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  maxAt: number;
  firstSeen: number;
  lastSeen: number;
}

interface LogRow {
  ts: number;
  method: string;
  shapeId: string | null;
  ms: number;
  ok: boolean;
  errorCode: number | null;
  errorMessage: string | null;
  query: string | null;
}

const UNPARSED = "(unparsed query)";
/** A shape is kept only when it looks like a query: at least one placeholder and no long run of bare words. */
export function shapeTextFor(query: string): string {
  const shape = normalizeShape(query).slice(0, TEXT_MAX);
  if (!shape.includes("?")) return UNPARSED;
  if (/(?:\b[A-Za-z_][A-Za-z0-9_]*\s+){3,}/.test(shape.replace(/\b(AND|OR|NOT|BETWEEN|LIKE|IN|ORDER|BY|ASC|DESC|LIMIT|OFFSET)\b/g, ""))) return UNPARSED;
  return shape;
}

export function stripText<T extends { query?: string | null; sample?: string | null }>(r: T): T {
  if (!("query" in r) && !("sample" in r)) return r;
  const { query: _q, sample: _s, ...rest } = r;
  return rest as T;
}

export function percentileOf(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export class LiveQueries {
  private ring: RecentRequest[] = [];
  private pendingEvents: RecentRequest[] = [];
  private pendingShapes = new Map<string, ShapeAcc>();
  private pendingLog: LogRow[] = [];
  private reservoirs = new Map<string, number[]>();
  private timer: NodeJS.Timeout | null = null;
  lastRequestAt: number | null = null;

  constructor(
    private readonly ctx: Ctx,
    readonly slowMs: number,
  ) {}

  /**
   * One JSON-RPC call (one entry of a batch counts once). `text` is the arkiv_query string for arkiv_query, the
   * params JSON for everything else; `error` is what the node answered when the call failed.
   */
  observe(
    method: string,
    ms: number,
    ok: boolean,
    batch: boolean,
    text: string | null,
    now = Date.now(),
    error: { code: number | null; message: string } | null = null,
  ): void {
    try {
      const rounded = Math.round(ms * 10) / 10;
      const q = text !== null ? text.slice(0, TEXT_MAX) : null;
      const isQuery = method === "arkiv_query" && q !== null;
      const shapeText = isQuery ? shapeTextFor(q) : null;
      const sid = isQuery ? (shapeText === UNPARSED ? "s_unparsed" : shapeId(q)) : null;
      const errMessage = error ? error.message.slice(0, 200) : null;
      const row: RecentRequest = { t: now, method, shapeId: sid, ms: rounded, ok, batch, query: q, error: ok ? null : errMessage };
      this.ring.push(row);
      if (this.ring.length > RING) this.ring.splice(0, this.ring.length - RING);
      this.pendingEvents.push(row);
      this.pendingLog.push({ ts: now, method, shapeId: sid, ms: rounded, ok, errorCode: error?.code ?? null, errorMessage: ok ? null : errMessage, query: q });
      this.lastRequestAt = now;
      if (sid !== null && shapeText !== null) {
        let acc = this.pendingShapes.get(sid);
        if (!acc) this.pendingShapes.set(sid, (acc = { method, shape: shapeText, sample: q!, count: 0, errors: 0, totalMs: 0, maxMs: 0, maxAt: now, firstSeen: now, lastSeen: now }));
        acc.count++;
        acc.sample = q!;
        if (!ok) acc.errors++;
        acc.totalMs += ms;
        if (ms > acc.maxMs) {
          acc.maxMs = ms;
          acc.maxAt = now;
        }
        acc.lastSeen = now;
        let r = this.reservoirs.get(sid);
        if (!r) this.reservoirs.set(sid, (r = []));
        if (r.length >= RESERVOIR) r.shift();
        r.push(ms);
      }
      if (!this.timer) this.timer = setTimeout(() => this.emit(), 1000);
    } catch {
      /* recording never breaks forwarding */
    }
  }

  private emit(): void {
    this.timer = null;
    if (this.pendingEvents.length === 0) return;
    const batch = this.pendingEvents.splice(0, this.pendingEvents.length).slice(-100);
    this.ctx.bus.publish({ event: "rpc", data: batch }); // the stream route strips `query` for viewers
  }

  /** Persist pending rows (called from the 15 s rpc-flush job and before every read). */
  flush(now = Date.now()): void {
    const db = this.ctx.db;
    const shapes = [...this.pendingShapes.entries()];
    const log = this.pendingLog.splice(0, this.pendingLog.length);
    this.pendingShapes.clear();
    if (shapes.length === 0 && log.length === 0) return;
    const upsert = db.prepare(
      `INSERT INTO rpc_shapes(shape_id, method, shape, sample, count, errors, total_ms, max_ms, max_at, first_seen, last_seen)
       VALUES (@id, @method, @shape, @sample, @count, @errors, @totalMs, @maxMs, @maxAt, @firstSeen, @lastSeen)
       ON CONFLICT(shape_id) DO UPDATE SET
         count = count + excluded.count, errors = errors + excluded.errors, total_ms = total_ms + excluded.total_ms,
         max_at = CASE WHEN excluded.max_ms > max_ms THEN excluded.max_at ELSE max_at END,
         max_ms = MAX(max_ms, excluded.max_ms), last_seen = MAX(last_seen, excluded.last_seen), sample = excluded.sample`,
    );
    const insLog = db.prepare("INSERT INTO rpc_requests_log(ts, method, shape_id, ms, ok, error_code, error_message, query) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (const [id, a] of shapes) upsert.run({ id, ...a });
      for (const r of log) insLog.run(r.ts, r.method, r.shapeId, r.ms, r.ok ? 1 : 0, r.errorCode, r.errorMessage, r.query);
      const n = (db.prepare("SELECT COUNT(*) AS n FROM rpc_shapes").get() as { n: number }).n;
      if (n > MAX_SHAPES) db.prepare("DELETE FROM rpc_shapes WHERE shape_id IN (SELECT shape_id FROM rpc_shapes ORDER BY last_seen ASC LIMIT ?)").run(n - MAX_SHAPES);
      db.prepare("DELETE FROM rpc_requests_log WHERE ts < ?").run(now - LOG_RETENTION_MS);
      const m = (db.prepare("SELECT COUNT(*) AS n FROM rpc_requests_log").get() as { n: number }).n;
      if (m > LOG_MAX_ROWS) db.prepare("DELETE FROM rpc_requests_log WHERE id IN (SELECT id FROM rpc_requests_log ORDER BY ts ASC LIMIT ?)").run(m - LOG_MAX_ROWS);
    })();
  }

  /** Shapes seen since `sinceMs` ago (by last_seen), slowest first. Percentiles come from the in-memory reservoir. */
  shapes(sinceMs: number, limit = 50, now = Date.now(), withText = false): QueryShapeRow[] {
    this.flush(now);
    const rows = this.ctx.db
      .prepare("SELECT shape_id, method, shape, sample, count, errors, total_ms, max_ms, max_at, first_seen, last_seen FROM rpc_shapes WHERE last_seen >= ? ORDER BY max_ms DESC LIMIT ?")
      .all(now - sinceMs, limit) as { shape_id: string; method: string; shape: string; sample: string | null; count: number; errors: number; total_ms: number; max_ms: number; max_at: number; first_seen: number; last_seen: number }[];
    return rows
      .map((r) => {
        const res = this.reservoirs.get(r.shape_id) ?? [];
        const row: QueryShapeRow = {
          shapeId: r.shape_id,
          method: r.method,
          shape: r.shape,
          count: r.count,
          errors: r.errors,
          avgMs: r.count ? Math.round((r.total_ms / r.count) * 10) / 10 : 0,
          p50Ms: percentileOf(res, 50),
          p95Ms: percentileOf(res, 95),
          maxMs: Math.round(r.max_ms * 10) / 10,
          maxAt: r.max_at,
          firstSeen: r.first_seen,
          lastSeen: r.last_seen,
          ...(withText ? { sample: r.sample } : {}),
        };
        return row;
      })
      .sort((a, b) => (b.p95Ms ?? b.avgMs) - (a.p95Ms ?? a.avgMs));
  }

  private rowToRecent(r: { ts: number; method: string; shape_id: string | null; ms: number; ok: number; error_message: string | null; query: string | null }, withText: boolean): RecentRequest {
    return { t: r.ts, method: r.method, shapeId: r.shape_id, ms: r.ms, ok: r.ok === 1, batch: false, error: r.error_message, ...(withText ? { query: r.query } : {}) };
  }

  /** The newest requests, from the log (survives restarts). */
  recent(limit = 50, withText = false, now = Date.now()): RecentRequest[] {
    this.flush(now);
    const rows = this.ctx.db
      .prepare("SELECT ts, method, shape_id, ms, ok, error_message, query FROM rpc_requests_log ORDER BY ts DESC, id DESC LIMIT ?")
      .all(limit) as Parameters<LiveQueries["rowToRecent"]>[0][];
    return rows.map((r) => this.rowToRecent(r, withText));
  }

  slowest(sinceMs: number, limit = 20, now = Date.now(), withText = false): SlowRequest[] {
    this.flush(now);
    const rows = this.ctx.db
      .prepare(
        "SELECT l.ts, l.method, l.shape_id, l.ms, l.ok, l.error_message, l.query, p.shape FROM rpc_requests_log l LEFT JOIN rpc_shapes p ON p.shape_id = l.shape_id WHERE l.ts >= ? AND l.ms >= ? ORDER BY l.ms DESC LIMIT ?",
      )
      .all(now - sinceMs, this.slowMs, limit) as { ts: number; method: string; shape_id: string | null; ms: number; ok: number; error_message: string | null; query: string | null; shape: string | null }[];
    return rows.map((r) => ({ t: r.ts, method: r.method, shapeId: r.shape_id, shape: r.shape, ms: r.ms, ok: r.ok === 1, error: r.error_message, ...(withText ? { query: r.query } : {}) }));
  }

  /** Failed calls per method in the range, with the node's latest answer. */
  errors(sinceMs: number, now = Date.now()): MethodError[] {
    this.flush(now);
    const rows = this.ctx.db
      .prepare(
        `SELECT method, COUNT(*) AS count, MAX(ts) AS last_at,
                (SELECT error_code FROM rpc_requests_log x WHERE x.method = l.method AND x.ok = 0 AND x.ts >= ? ORDER BY x.ts DESC LIMIT 1) AS last_code,
                (SELECT error_message FROM rpc_requests_log x WHERE x.method = l.method AND x.ok = 0 AND x.ts >= ? ORDER BY x.ts DESC LIMIT 1) AS last_message
         FROM rpc_requests_log l WHERE l.ok = 0 AND l.ts >= ? GROUP BY method ORDER BY count DESC LIMIT 50`,
      )
      .all(now - sinceMs, now - sinceMs, now - sinceMs) as { method: string; count: number; last_at: number; last_code: number | null; last_message: string | null }[];
    return rows.map((r) => ({ method: r.method, count: r.count, lastCode: r.last_code, lastMessage: r.last_message ?? "", lastAt: r.last_at }));
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
