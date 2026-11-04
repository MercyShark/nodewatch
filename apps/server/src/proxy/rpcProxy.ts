// Second listener (PROXY_PORT) that forwards JSON-RPC to EL_RPC_URL and records per-method metrics.
// FAIL-OPEN: if parsing or recording fails, the request is forwarded untouched. Payloads are never
// rewritten. Passive mode (default) only sees traffic sent to it; inline mode is opt-in.
import http from "node:http";
import { request as undiciRequest } from "undici";
import type { Ctx } from "../context.js";
import { rpcDuration, rpcRequests } from "../metrics.js";
import { parseRpcBody, shapeId } from "./shape.js";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host", "content-length"]);
const MAX_INSPECT = 256 * 1024;

interface Win {
  count: number;
  errors: number;
  lat: number[];
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export class RpcStats {
  private win = new Map<string, Win>();
  private known = new Set<string>();
  private perSec = new Array<number>(60).fill(0);
  private secIdx = Math.floor(Date.now() / 1000);
  readonly shapes = new Map<string, { count: number; totalMs: number; maxMs: number; errors: number }>();

  private tickSec(now: number): void {
    const s = Math.floor(now / 1000);
    if (s - this.secIdx >= 60) this.perSec.fill(0);
    else for (let i = this.secIdx + 1; i <= s; i++) this.perSec[i % 60] = 0;
    this.secIdx = Math.max(this.secIdx, s);
  }

  observe(method: string, ms: number, error: boolean, now = Date.now()): void {
    const key = this.known.size >= 200 && !this.known.has(method) ? "other" : method;
    this.known.add(key);
    let w = this.win.get(key);
    if (!w) this.win.set(key, (w = { count: 0, errors: 0, lat: [] }));
    w.count++;
    if (error) w.errors++;
    if (w.lat.length < 5000) w.lat.push(ms);
    this.tickSec(now);
    this.perSec[Math.floor(now / 1000) % 60]!++;
    rpcRequests.inc({ method: key, outcome: error ? "error" : "ok" });
    rpcDuration.observe({ method: key }, ms / 1000);
  }

  observeShape(query: string, ms: number, error: boolean): void {
    const id = shapeId(query);
    let s = this.shapes.get(id);
    if (!s) {
      if (this.shapes.size >= 500) return;
      this.shapes.set(id, (s = { count: 0, totalMs: 0, maxMs: 0, errors: 0 }));
    }
    s.count++;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    if (error) s.errors++;
  }

  requestsLastMinute(now = Date.now()): number {
    this.tickSec(now);
    return this.perSec.reduce((a, b) => a + b, 0);
  }

  /** Write the current window to the time series (every 15 s), including zeros for known methods. */
  flush(ctx: Ctx, now = Date.now()): void {
    for (const method of this.known) {
      const w = this.win.get(method) ?? { count: 0, errors: 0, lat: [] };
      const labels = { method };
      ctx.tsdb.record("rpc_requests", w.count, labels, now);
      ctx.tsdb.record("rpc_errors", w.errors, labels, now);
      if (w.lat.length) {
        const sorted = [...w.lat].sort((a, b) => a - b);
        ctx.tsdb.record("rpc_latency_p50_ms", percentile(sorted, 50), labels, now);
        ctx.tsdb.record("rpc_latency_p95_ms", percentile(sorted, 95), labels, now);
      }
    }
    this.win.clear();
  }
}

/** Ids (JSON-stringified) of responses that carry an `error`; "*" when the body is not JSON-RPC. */
export function errorIds(text: string): Set<string> {
  const out = new Set<string>();
  try {
    const j = JSON.parse(text) as unknown;
    for (const x of Array.isArray(j) ? j : [j]) {
      if (x && typeof x === "object" && "error" in x && (x as { error: unknown }).error != null) out.add(JSON.stringify((x as { id?: unknown }).id ?? null));
    }
  } catch {
    out.add("*");
  }
  return out;
}

export function startProxy(ctx: Ctx, stats: RpcStats): http.Server {
  const target = new URL(ctx.cfg.EL_RPC_URL);
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      chunks.push(c);
    });
    req.on("error", () => res.destroy());
    req.on("end", () => {
      const body = Buffer.concat(chunks, size);
      let parsed: ReturnType<typeof parseRpcBody> = null;
      try {
        parsed = parseRpcBody(body);
      } catch {
        parsed = null; // fail-open
      }
      const started = performance.now();
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!HOP_BY_HOP.has(k.toLowerCase()) && typeof v === "string") headers[k] = v;
      }
      const url = new URL(req.url ?? "/", target);
      url.pathname = target.pathname.replace(/\/$/, "") + (req.url && req.url !== "/" ? url.pathname : "");
      undiciRequest(url, {
        method: (req.method ?? "POST") as "POST",
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
        headersTimeout: 60_000,
        bodyTimeout: 120_000,
      })
        .then((up) => {
          const outHeaders: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(up.headers)) if (v !== undefined && !HOP_BY_HOP.has(k)) outHeaders[k] = v;
          res.writeHead(up.statusCode, outHeaders);
          const inspect: Buffer[] = [];
          let inspected = 0;
          up.body.on("data", (c: Buffer) => {
            if (inspected < MAX_INSPECT) {
              inspect.push(c);
              inspected += c.length;
            }
            res.write(c);
          });
          up.body.on("end", () => {
            res.end();
            try {
              if (!parsed) return;
              const ms = performance.now() - started;
              const text = inspected < MAX_INSPECT ? Buffer.concat(inspect).toString("utf8") : "";
              const httpErr = up.statusCode >= 400;
              const errs = text !== "" ? errorIds(text) : new Set<string>();
              const isErr = (i: number) => httpErr || errs.has("*") || errs.has(JSON.stringify(parsed!.ids[i] ?? null));
              parsed.methods.forEach((m, i) => stats.observe(m, ms, isErr(i)));
              const anyQueryErr = parsed.methods.some((m, i) => m === "arkiv_query" && isErr(i));
              for (const q of parsed.queries) stats.observeShape(q, ms, anyQueryErr);
            } catch {
              /* recording never breaks forwarding */
            }
          });
          up.body.on("error", () => res.destroy());
        })
        .catch((e: unknown) => {
          try {
            if (parsed) for (const m of parsed.methods) stats.observe(m, performance.now() - started, true);
          } catch {
            /* ignore */
          }
          if (!res.headersSent) {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `upstream unavailable: ${(e as Error).message}` } }));
          } else res.destroy();
        });
    });
  });
  server.on("clientError", (_e, socket) => socket.destroy());
  server.listen(ctx.cfg.PROXY_PORT, ctx.cfg.PROXY_HOST, () => ctx.log.info({ port: ctx.cfg.PROXY_PORT, mode: ctx.cfg.PROXY_MODE }, "rpc proxy listening"));
  server.on("error", (err) => ctx.log.error({ err: err.message }, "rpc proxy listener error"));
  return server;
}
