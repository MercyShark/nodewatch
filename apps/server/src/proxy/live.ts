// Live queries: what the proxy sees, per request. A ring of recent requests for the live feed (SSE "rpc" event,
// batched once a second), per-shape counters persisted in rpc_shapes (shape text is normalised, never raw), and the
// slowest individual requests in rpc_slow. Fed by RpcStats; nothing here can break forwarding (every call is wrapped).
import type { MethodError, QueryShapeRow, RecentRequest, SlowRequest } from "@nodewatch/shared";
import type { Ctx } from "../context.js";
import { normalizeShape, shapeId } from "./shape.js";

const RING = 500;
const RESERVOIR = 256;
const MAX_SHAPES = 2000;
const SLOW_RETENTION_MS = 48 * 3600_000;
const SLOW_MAX_ROWS = 5000;
const SLOW_TEXT_MAX = 300; // raw text of the slowest requests kept in memory for the admin
/** Same line as the slow-query finder: a read over 250 ms is slow. */
export const SLOW_MS = 250;

interface ShapeAcc {
  method: string;
  shape: string;
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  maxAt: number;
  firstSeen: number;
  lastSeen: number;
}

const UNPARSED = "(unparsed query)";
/** A shape is kept only when it looks like a query: at least one placeholder and no long run of bare words. */
export function shapeTextFor(query: string): string {
  const shape = normalizeShape(query).slice(0, 2000);
  if (!shape.includes("?")) return UNPARSED;
  if (/(?:\b[A-Za-z_][A-Za-z0-9_]*\s+){3,}/.test(shape.replace(/\b(AND|OR|NOT|BETWEEN|LIKE|IN|ORDER|BY|ASC|DESC|LIMIT|OFFSET)\b/g, ""))) return UNPARSED;
  return shape;
}

export function stripText<T extends { query?: string | null }>(r: T): T {
  if (!("query" in r)) return r;
  const { query: _q, ...rest } = r;
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
  private pendingSlow: SlowRequest[] = [];
  private reservoirs = new Map<string, number[]>();
  /** Raw text of slow requests, memory only, keyed by `${t}:${ms}` (the row in rpc_slow has the same pair). */
  private slowText = new Map<string, string>();
  /** What the node answered when a method failed, per method, since the last restart. */
  private errorsByMethod = new Map<string, MethodError>();
  private timer: NodeJS.Timeout | null = null;
  lastRequestAt: number | null = null;

  constructor(
    private readonly ctx: Ctx,
    readonly slowMs: number,
  ) {}

  /** One JSON-RPC call (one entry of a batch counts once). `query` is the raw arkiv_query text; only its shape is kept. */
  observe(method: string, ms: number, ok: boolean, batch: boolean, query: string | null, now = Date.now(), error: { code: number | null; message: string } | null = null): void {
    try {
      if (!ok) {
        const e = this.errorsByMethod.get(method) ?? { method, count: 0, lastCode: null, lastMessage: "", lastAt: 0 };
        e.count++;
        e.lastAt = now;
        if (error) {
          e.lastCode = error.code;
          e.lastMessage = error.message.slice(0, 200);
        }
        if (this.errorsByMethod.size < 200 || this.errorsByMethod.has(method)) this.errorsByMethod.set(method, e);
      }
      const text = query !== null ? shapeTextFor(query) : null;
      const sid = query !== null ? (text === UNPARSED ? "s_unparsed" : shapeId(query)) : null;
      const row: RecentRequest = { t: now, method, shapeId: sid, ms: Math.round(ms * 10) / 10, ok, batch, query: query !== null ? query.slice(0, 2000) : null };
      this.ring.push(row);
      if (this.ring.length > RING) this.ring.splice(0, this.ring.length - RING);
      this.pendingEvents.push(row);
      this.lastRequestAt = now;
      if (sid !== null && query !== null) {
        let acc = this.pendingShapes.get(sid);
        if (!acc) this.pendingShapes.set(sid, (acc = { method, shape: text!, count: 0, errors: 0, totalMs: 0, maxMs: 0, maxAt: now, firstSeen: now, lastSeen: now }));
        acc.count++;
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
      if (ms >= this.slowMs) {
        const rounded = Math.round(ms * 10) / 10;
        this.pendingSlow.push({ t: now, method, shapeId: sid, shape: null, ms: rounded, ok });
        if (query !== null) {
          this.slowText.set(`${now}:${rounded}`, query.slice(0, 2000));
          if (this.slowText.size > SLOW_TEXT_MAX) this.slowText.delete(this.slowText.keys().next().value!);
        }
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

  errors(): MethodError[] {
    return [...this.errorsByMethod.values()].sort((a, b) => b.count - a.count);
  }

  recent(limit = 50, withText = false): RecentRequest[] {
    return this.ring.slice(-limit).reverse().map((r) => (withText ? r : stripText(r)));
  }

  /** Persist pending counters (called from the 15 s rpc-flush job). */
  flush(now = Date.now()): void {
    const db = this.ctx.db;
    const shapes = [...this.pendingShapes.entries()];
    const slow = this.pendingSlow.splice(0, this.pendingSlow.length);
    this.pendingShapes.clear();
    if (shapes.length === 0 && slow.length === 0) return;
    const upsert = db.prepare(
      `INSERT INTO rpc_shapes(shape_id, method, shape, count, errors, total_ms, max_ms, max_at, first_seen, last_seen)
       VALUES (@id, @method, @shape, @count, @errors, @totalMs, @maxMs, @maxAt, @firstSeen, @lastSeen)
       ON CONFLICT(shape_id) DO UPDATE SET
         count = count + excluded.count, errors = errors + excluded.errors, total_ms = total_ms + excluded.total_ms,
         max_at = CASE WHEN excluded.max_ms > max_ms THEN excluded.max_at ELSE max_at END,
         max_ms = MAX(max_ms, excluded.max_ms), last_seen = MAX(last_seen, excluded.last_seen)`,
    );
    const insSlow = db.prepare("INSERT INTO rpc_slow(ts, method, shape_id, ms, ok) VALUES (?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (const [id, a] of shapes) upsert.run({ id, ...a });
      for (const s of slow) insSlow.run(s.t, s.method, s.shapeId, s.ms, s.ok ? 1 : 0);
      // Caps: least-recently-seen shapes, old or surplus slow rows.
      const n = (db.prepare("SELECT COUNT(*) AS n FROM rpc_shapes").get() as { n: number }).n;
      if (n > MAX_SHAPES) db.prepare("DELETE FROM rpc_shapes WHERE shape_id IN (SELECT shape_id FROM rpc_shapes ORDER BY last_seen ASC LIMIT ?)").run(n - MAX_SHAPES);
      db.prepare("DELETE FROM rpc_slow WHERE ts < ?").run(now - SLOW_RETENTION_MS);
      const m = (db.prepare("SELECT COUNT(*) AS n FROM rpc_slow").get() as { n: number }).n;
      if (m > SLOW_MAX_ROWS) db.prepare("DELETE FROM rpc_slow WHERE id IN (SELECT id FROM rpc_slow ORDER BY ms ASC LIMIT ?)").run(m - SLOW_MAX_ROWS);
    })();
  }

  /** Shapes seen since `sinceMs` ago (by last_seen), slowest first. Percentiles come from the in-memory reservoir. */
  shapes(sinceMs: number, limit = 50, now = Date.now()): QueryShapeRow[] {
    this.flush(now);
    const rows = this.ctx.db
      .prepare("SELECT shape_id, method, shape, count, errors, total_ms, max_ms, max_at, first_seen, last_seen FROM rpc_shapes WHERE last_seen >= ? ORDER BY max_ms DESC LIMIT ?")
      .all(now - sinceMs, limit) as { shape_id: string; method: string; shape: string; count: number; errors: number; total_ms: number; max_ms: number; max_at: number; first_seen: number; last_seen: number }[];
    return rows
      .map((r) => {
        const res = this.reservoirs.get(r.shape_id) ?? [];
        return {
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
        };
      })
      .sort((a, b) => (b.p95Ms ?? b.avgMs) - (a.p95Ms ?? a.avgMs));
  }

  slowest(sinceMs: number, limit = 20, now = Date.now(), withText = false): SlowRequest[] {
    this.flush(now);
    const rows = this.ctx.db
      .prepare("SELECT s.ts, s.method, s.shape_id, s.ms, s.ok, p.shape FROM rpc_slow s LEFT JOIN rpc_shapes p ON p.shape_id = s.shape_id WHERE s.ts >= ? ORDER BY s.ms DESC LIMIT ?")
      .all(now - sinceMs, limit) as { ts: number; method: string; shape_id: string | null; ms: number; ok: number; shape: string | null }[];
    return rows.map((r) => ({ t: r.ts, method: r.method, shapeId: r.shape_id, shape: r.shape, ms: r.ms, ok: r.ok === 1, ...(withText ? { query: this.slowText.get(`${r.ts}:${r.ms}`) ?? null } : {}) }));
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
