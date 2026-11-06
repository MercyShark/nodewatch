// Slow-request digest: once a minute, every request the proxy saw above the slowRequestMs threshold (Settings →
// thresholds, default 750 ms) goes to Slack as one message. Reads rpc_requests_log, so nothing is missed across the
// minute and nothing is sent twice. Honours a global silence (rule = null) and a silence on "SlowRequests".
import type { Ctx } from "../context.js";
import { thresholds } from "./rules.js";

export interface SlowRow {
  ts: number;
  method: string;
  ms: number;
  ok: number;
  error_message: string | null;
  query: string | null;
}

const MAX_LINES = 8;
const TEXT_CHARS = 160;

export function formatDigest(node: string, rows: SlowRow[], thresholdMs: number, windowSec: number): string {
  const n = rows.length;
  const head = `Nodewatch on ${node}: ${n} request${n === 1 ? "" : "s"} over ${thresholdMs} ms in the last ${windowSec} s`;
  const lines = rows.slice(0, MAX_LINES).map((r) => {
    const text = r.query ? ` ${r.query.replace(/\s+/g, " ").slice(0, TEXT_CHARS)}${r.query.length > TEXT_CHARS ? "…" : ""}` : "";
    const outcome = r.ok ? "" : ` → ${r.error_message ?? "error"}`;
    return `• ${Math.round(r.ms).toLocaleString("en-US")} ms ${r.method}${text}${outcome}`;
  });
  if (n > MAX_LINES) lines.push(`… and ${n - MAX_LINES} more`);
  return [head, ...lines].join("\n");
}

export class SlowRequestDigest {
  private since: number;

  constructor(
    private readonly ctx: Ctx,
    private readonly node: string,
    private readonly send: (text: string) => Promise<{ ok: boolean; error: string | null }>,
    private readonly silenced: () => boolean,
    private readonly enabled: () => boolean,
    now = Date.now(),
  ) {
    this.since = now;
  }

  /** Rows above the threshold since the last tick, oldest first, slowest first within the same second. */
  pending(now = Date.now()): { rows: SlowRow[]; thresholdMs: number } {
    const thresholdMs = thresholds(this.ctx).slowRequestMs;
    const rows = this.ctx.db
      .prepare("SELECT ts, method, ms, ok, error_message, query FROM rpc_requests_log WHERE ts > ? AND ts <= ? AND ms >= ? ORDER BY ms DESC LIMIT 200")
      .all(this.since, now, thresholdMs) as SlowRow[];
    return { rows, thresholdMs };
  }

  async tick(now = Date.now()): Promise<{ sent: number }> {
    const windowSec = Math.max(1, Math.round((now - this.since) / 1000));
    const { rows, thresholdMs } = this.pending(now);
    this.since = now; // never send the same request twice, even if the channel is off or silenced
    if (rows.length === 0 || !this.enabled() || this.silenced()) return { sent: 0 };
    const r = await this.send(formatDigest(this.node, rows, thresholdMs, windowSec));
    return { sent: r.ok ? rows.length : 0 };
  }
}
