// Slow-request notifications: every request the proxy saw above the slowRequestMs threshold (Settings → thresholds,
// default 750 ms) goes to Telegram as its own message, with the timing, the outcome and the actual request text.
// Reads rpc_requests_log since the last tick (every 10 s), so nothing is missed and nothing is sent twice. Telegram
// blocks bots that flood, so at most MAX_PER_MINUTE messages go out per minute; the rest become one "N more" line.
// Honours a global silence (rule = null) and a silence on "SlowRequests".
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

export const MAX_PER_MINUTE = 20;
const TEXT_CHARS = 1500;

export function formatSlowRequest(node: string, r: SlowRow, thresholdMs: number): string {
  const when = new Date(r.ts).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const outcome = r.ok ? "ok" : `error: ${r.error_message ?? "unknown"}`;
  const text = r.query ? r.query.slice(0, TEXT_CHARS) + (r.query.length > TEXT_CHARS ? "…" : "") : "(no parameters)";
  return [`Slow request on ${node}: ${Math.round(r.ms).toLocaleString("en-US")} ms (limit ${thresholdMs} ms)`, `${r.method} · ${outcome} · ${when}`, text].join("\n");
}

export function formatOverflow(node: string, n: number, thresholdMs: number): string {
  return `Nodewatch on ${node}: ${n} more request${n === 1 ? "" : "s"} over ${thresholdMs} ms in the last minute. The Live queries page has all of them.`;
}

export class SlowRequestDigest {
  private since: number;
  private minuteStart: number;
  private sentThisMinute = 0;
  private heldBack = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly node: string,
    private readonly send: (text: string) => Promise<{ ok: boolean; error: string | null }>,
    private readonly silenced: () => boolean,
    private readonly enabled: () => boolean,
    now = Date.now(),
  ) {
    this.since = now;
    this.minuteStart = now;
  }

  /** Rows above the threshold since the last tick, oldest first. */
  pending(now = Date.now()): { rows: SlowRow[]; thresholdMs: number } {
    const thresholdMs = thresholds(this.ctx).slowRequestMs;
    const rows = this.ctx.db
      .prepare("SELECT ts, method, ms, ok, error_message, query FROM rpc_requests_log WHERE ts > ? AND ts <= ? AND ms >= ? ORDER BY ts ASC, ms DESC LIMIT 500")
      .all(this.since, now, thresholdMs) as SlowRow[];
    return { rows, thresholdMs };
  }

  async tick(now = Date.now()): Promise<{ sent: number; heldBack: number }> {
    const { rows, thresholdMs } = this.pending(now);
    this.since = now; // never send the same request twice, even if the channel is off or silenced
    if (now - this.minuteStart >= 60_000) {
      // A new minute: report what the flood guard held back, then reset.
      if (this.heldBack > 0 && this.enabled() && !this.silenced()) await this.send(formatOverflow(this.node, this.heldBack, thresholdMs));
      this.minuteStart = now;
      this.sentThisMinute = 0;
      this.heldBack = 0;
    }
    if (rows.length === 0 || !this.enabled() || this.silenced()) return { sent: 0, heldBack: 0 };
    let sent = 0;
    let heldBack = 0;
    for (const r of rows) {
      if (this.sentThisMinute >= MAX_PER_MINUTE) {
        heldBack++;
        continue;
      }
      const res = await this.send(formatSlowRequest(this.node, r, thresholdMs));
      this.sentThisMinute++;
      if (res.ok) sent++;
    }
    this.heldBack += heldBack;
    return { sent, heldBack };
  }
}
