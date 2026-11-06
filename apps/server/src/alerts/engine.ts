// Built-in alert engine: inactive → pending (for N) → firing → resolved. Dedupe key = rule + node,
// grouping within 30 s, inhibition, silences, resolve notifications, retries with backoff,
// every send logged to alerts_log.
import { randomUUID } from "node:crypto";
import os from "node:os";
import type { AlertEvent, AlertsResponse, ChannelName, Silence } from "@nodewatch/shared";
import type { Ctx } from "../context.js";
import { notifierSends } from "../metrics.js";
import { errMsg } from "../util/http.js";
import { buildNotifiers, type Notification, type Notifier } from "./notifiers/index.js";
import { RULES, thresholds, type Rule, type RuleInput } from "./rules.js";

type AlertState = "inactive" | "pending" | "firing";

interface StateRow {
  key: string;
  rule: string;
  node: string;
  state: AlertState;
  severity: string;
  summary: string;
  pending_since: number | null;
  started_at: number | null;
  resolved_at: number | null;
  event_id: string | null;
}

type Queued = AlertEvent & { dedupeKey: string };

export interface EngineOptions {
  groupWaitMs?: number;
  retryBaseMs?: number;
  maxAttempts?: number;
  notifiers?: Notifier[];
  rules?: Rule[];
}

export class AlertEngine {
  readonly notifiers: Notifier[];
  private readonly rules: Rule[];
  readonly node: string;
  private queue: Queued[] = [];
  private groupTimer: NodeJS.Timeout | null = null;
  private readonly groupWaitMs: number;
  private readonly retryBaseMs: number;
  private readonly maxAttempts: number;
  private channelStatus = new Map<ChannelName, { lastSendAt: number | null; lastError: string | null }>();

  constructor(
    private readonly ctx: Ctx,
    private readonly rpc5m: () => RuleInput["rpc5m"],
    opts: EngineOptions = {},
  ) {
    this.notifiers = opts.notifiers ?? buildNotifiers(ctx.cfg);
    this.rules = opts.rules ?? RULES;
    this.groupWaitMs = opts.groupWaitMs ?? 30_000;
    this.retryBaseMs = opts.retryBaseMs ?? 2000;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.node = ctx.cfg.INSTANCE_NAME ?? ctx.cfg.PROVIDER_ADDRESS ?? os.hostname();
    for (const n of this.notifiers) {
      const last = ctx.db
        .prepare("SELECT ts, ok, error FROM alerts_log WHERE channel = ? ORDER BY ts DESC LIMIT 1")
        .get(n.name) as { ts: number; ok: number; error: string | null } | undefined;
      const lastOk = ctx.db.prepare("SELECT MAX(ts) AS t FROM alerts_log WHERE channel = ? AND ok = 1").get(n.name) as { t: number | null };
      this.channelStatus.set(n.name, { lastSendAt: lastOk.t, lastError: last && !last.ok ? last.error : null });
    }
  }

  private loadState(key: string): StateRow | undefined {
    return this.ctx.db.prepare("SELECT * FROM alerts_state WHERE key = ?").get(key) as StateRow | undefined;
  }

  private saveState(r: StateRow, now: number): void {
    this.ctx.db
      .prepare(
        `INSERT INTO alerts_state(key, rule, node, state, severity, summary, pending_since, started_at, resolved_at, event_id, updated_at)
         VALUES (@key, @rule, @node, @state, @severity, @summary, @pending_since, @started_at, @resolved_at, @event_id, @updated_at)
         ON CONFLICT(key) DO UPDATE SET state=@state, severity=@severity, summary=@summary, pending_since=@pending_since,
           started_at=@started_at, resolved_at=@resolved_at, event_id=@event_id, updated_at=@updated_at`,
      )
      .run({ ...r, updated_at: now });
  }

  isSilenced(rule: string, now = Date.now()): boolean {
    const r = this.ctx.db.prepare("SELECT 1 FROM silences WHERE until > ? AND (rule IS NULL OR rule = ?) LIMIT 1").get(now, rule);
    return !!r;
  }

  /** One evaluation round (every 15 s). */
  evaluate(now = Date.now()): void {
    const input: RuleInput = { ctx: this.ctx, th: thresholds(this.ctx), now, rpc5m: this.rpc5m() };
    const results = new Map<string, ReturnType<Rule["eval"]>>();
    for (const rule of this.rules) {
      try {
        results.set(rule.name, rule.eval(input));
      } catch (err) {
        this.ctx.log.warn({ rule: rule.name, err: errMsg(err) }, "rule evaluation failed");
        results.set(rule.name, null);
      }
    }
    // Inhibition: rules suppressed by a firing (or newly active) inhibitor.
    const inhibited = new Set<string>();
    for (const rule of this.rules) {
      const r = results.get(rule.name);
      const st = this.loadState(`${rule.name}:${this.node}`);
      // An inhibitor counts while it is active now, or while it is firing and has no fresh data.
      if (rule.inhibits && (r?.active || ((r === null || r === undefined) && st?.state === "firing"))) for (const x of rule.inhibits) inhibited.add(x);
    }

    for (const rule of this.rules) {
      const res = results.get(rule.name);
      const key = `${rule.name}:${this.node}`;
      const cur: StateRow = this.loadState(key) ?? {
        key,
        rule: rule.name,
        node: this.node,
        state: "inactive",
        severity: rule.severity,
        summary: "",
        pending_since: null,
        started_at: null,
        resolved_at: null,
        event_id: null,
      };
      if (res === null || res === undefined) continue; // no data: keep state
      const active = res.active && !inhibited.has(rule.name);
      if (active) {
        cur.summary = res.summary;
        if (cur.state === "inactive") {
          cur.state = "pending";
          cur.pending_since = now;
        }
        if (cur.state === "pending" && now - (cur.pending_since ?? now) >= rule.forMs) {
          cur.state = "firing";
          cur.started_at = now;
          cur.resolved_at = null;
          cur.event_id = randomUUID();
          const ev: AlertEvent = { id: cur.event_id, rule: rule.name, severity: rule.severity, status: "firing", summary: res.summary, startedAt: now, resolvedAt: null };
          this.ctx.db
            .prepare("INSERT INTO alert_events(id, rule, severity, status, summary, started_at, resolved_at) VALUES (?, ?, ?, 'firing', ?, ?, NULL)")
            .run(ev.id, ev.rule, ev.severity, ev.summary, now);
          this.ctx.bus.alert(ev);
          if (!this.isSilenced(rule.name, now)) this.enqueue({ ...ev, dedupeKey: key });
        } else if (cur.state === "firing" && cur.event_id) {
          this.ctx.db.prepare("UPDATE alert_events SET summary = ? WHERE id = ?").run(res.summary, cur.event_id);
        }
      } else if (cur.state === "firing") {
        const ev: AlertEvent = {
          id: cur.event_id ?? randomUUID(),
          rule: rule.name,
          severity: rule.severity,
          status: "resolved",
          summary: cur.summary,
          startedAt: cur.started_at ?? now,
          resolvedAt: now,
        };
        this.ctx.db.prepare("UPDATE alert_events SET status = 'resolved', resolved_at = ? WHERE id = ?").run(now, ev.id);
        cur.state = "inactive";
        cur.resolved_at = now;
        cur.pending_since = null;
        this.ctx.bus.alert(ev);
        if (!this.isSilenced(rule.name, now)) this.enqueue({ ...ev, dedupeKey: key });
      } else {
        cur.state = "inactive";
        cur.pending_since = null;
      }
      this.saveState(cur, now);
    }
    this.ctx.db.prepare("DELETE FROM alert_events WHERE started_at < ?").run(now - 30 * 86_400_000);
  }

  private enqueue(a: Queued): void {
    // Dedupe: a later state for the same key replaces an earlier one still in the queue.
    this.queue = this.queue.filter((q) => !(q.dedupeKey === a.dedupeKey && q.status === a.status));
    this.queue.push(a);
    if (!this.groupTimer) {
      this.groupTimer = setTimeout(() => void this.flushGroup(), this.groupWaitMs);
      this.groupTimer.unref();
    }
  }

  async flushGroup(): Promise<void> {
    if (this.groupTimer) clearTimeout(this.groupTimer);
    this.groupTimer = null;
    const alerts = this.queue;
    this.queue = [];
    if (!alerts.length) return;
    await Promise.all(
      this.notifiers
        .filter((n) => n.configured)
        .map(async (n) => {
          const mine = alerts.filter((a) => n.accepts(a.severity));
          if (mine.length) await this.sendWithRetry(n, { alerts: mine, node: this.node }, "alert");
        }),
    );
  }

  private async sendWithRetry(n: Notifier, msg: Notification, kind: "alert" | "test" | "digest"): Promise<{ ok: boolean; error: string | null }> {
    let attempt = 0;
    let lastErr: string | null = null;
    while (attempt < this.maxAttempts) {
      attempt++;
      try {
        await n.send(msg);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = errMsg(err);
        if (attempt < this.maxAttempts) await new Promise((r) => setTimeout(r, this.retryBaseMs * 2 ** (attempt - 1)));
      }
    }
    const now = Date.now();
    const okSend = lastErr === null;
    this.ctx.db
      .prepare("INSERT INTO alerts_log(ts, channel, kind, rules, ok, attempts, error) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(now, n.name, kind, msg.alerts.map((a) => `${a.rule}:${a.status}`).join(",") || (kind === "digest" ? "SlowRequests" : "test"), okSend ? 1 : 0, attempt, lastErr);
    const st = this.channelStatus.get(n.name) ?? { lastSendAt: null, lastError: null };
    if (okSend) st.lastSendAt = now;
    st.lastError = lastErr;
    this.channelStatus.set(n.name, st);
    notifierSends.inc({ channel: n.name, ok: String(okSend) });
    if (!okSend) this.ctx.log.warn({ channel: n.name, err: lastErr }, "notification failed");
    return { ok: okSend, error: lastErr };
  }

  /** A free-form message (the slow-request digest) through a channel's retry, log and status path. */
  async sendText(channel: ChannelName, text: string): Promise<{ ok: boolean; error: string | null }> {
    const n = this.notifiers.find((x) => x.name === channel);
    if (!n) return { ok: false, error: "unknown channel" };
    if (!n.configured) return { ok: false, error: `${channel} is not configured` };
    return this.sendWithRetry(n, { alerts: [], node: this.node, text }, "digest");
  }

  async sendTest(channel: ChannelName): Promise<{ ok: boolean; error: string | null }> {
    const n = this.notifiers.find((x) => x.name === channel);
    if (!n) return { ok: false, error: "unknown channel" };
    if (!n.configured) return { ok: false, error: `${channel} is not configured (set its environment variables)` };
    return this.sendWithRetry(n, { alerts: [], node: this.node, test: true }, "test");
  }

  addSilence(rule: string | null, minutes: number, createdBy: string): Silence {
    const s: Silence = { id: randomUUID(), rule, until: Date.now() + minutes * 60_000, createdBy };
    this.ctx.db.prepare("INSERT INTO silences(id, rule, until, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(s.id, s.rule, s.until, s.createdBy, Date.now());
    return s;
  }

  removeSilence(id: string): boolean {
    return this.ctx.db.prepare("DELETE FROM silences WHERE id = ?").run(id).changes > 0;
  }

  active(): AlertEvent[] {
    return (this.ctx.db.prepare("SELECT * FROM alert_events WHERE status = 'firing' ORDER BY started_at DESC").all() as EventRow[]).map(toEvent);
  }

  history(limit = 100): AlertEvent[] {
    return (this.ctx.db.prepare("SELECT * FROM alert_events ORDER BY started_at DESC LIMIT ?").all(limit) as EventRow[]).map(toEvent);
  }

  response(): AlertsResponse {
    const now = Date.now();
    const silences = (this.ctx.db.prepare("SELECT id, rule, until, created_by FROM silences WHERE until > ? ORDER BY until").all(now) as {
      id: string;
      rule: string | null;
      until: number;
      created_by: string;
    }[]).map((s) => ({ id: s.id, rule: s.rule, until: s.until, createdBy: s.created_by }));
    return {
      channels: this.notifiers.map((n) => ({
        name: n.name,
        configured: n.configured,
        lastSendAt: this.channelStatus.get(n.name)?.lastSendAt ?? null,
        lastError: this.channelStatus.get(n.name)?.lastError ?? null,
      })),
      active: this.active(),
      history: this.history(),
      silences,
    };
  }

  ruleNames(): string[] {
    return this.rules.map((r) => r.name);
  }
}

interface EventRow {
  id: string;
  rule: string;
  severity: AlertEvent["severity"];
  status: AlertEvent["status"];
  summary: string;
  started_at: number;
  resolved_at: number | null;
}
const toEvent = (r: EventRow): AlertEvent => ({
  id: r.id,
  rule: r.rule,
  severity: r.severity,
  status: r.status,
  summary: r.summary,
  startedAt: r.started_at,
  resolvedAt: r.resolved_at,
});
