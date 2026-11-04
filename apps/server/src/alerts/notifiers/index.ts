// Telegram Bot API, Slack incoming webhook, PagerDuty Events API v2. Plain fetch, no SDKs.
// A channel is enabled only when its env values are set.
import type { AlertEvent, ChannelName, Severity } from "@nodewatch/shared";
import type { Config } from "../../config.js";
import { fetchWithTimeout } from "../../util/http.js";

export interface Notification {
  /** "firing" alerts and "resolved" alerts in one grouped message. */
  alerts: (AlertEvent & { dedupeKey: string })[];
  node: string;
  test?: boolean;
}

export interface Notifier {
  name: ChannelName;
  configured: boolean;
  /** Which severities this channel receives. */
  accepts: (s: Severity) => boolean;
  send: (n: Notification) => Promise<void>;
}

const icon = (a: AlertEvent) => (a.status === "resolved" ? "RESOLVED" : a.severity.toUpperCase());

export function formatText(n: Notification): string {
  if (n.test) return `Nodewatch test notification from ${n.node}. If you can read this, the channel works.`;
  const lines = n.alerts.map((a) => `[${icon(a)}] ${a.rule}: ${a.summary}`);
  return `Nodewatch on ${n.node}\n${lines.join("\n")}`;
}

async function ok(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = (await res.text().catch(() => "")).slice(0, 200);
  throw new Error(`${what}: HTTP ${res.status} ${body}`);
}

export function telegram(cfg: Config): Notifier {
  const token = cfg.TELEGRAM_BOT_TOKEN;
  const chat = cfg.TELEGRAM_CHAT_ID;
  return {
    name: "telegram",
    configured: !!(token && chat),
    accepts: () => true,
    async send(n) {
      const res = await fetchWithTimeout(
        `https://api.telegram.org/bot${token}/sendMessage`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: formatText(n), disable_web_page_preview: true }) },
        10_000,
      );
      await ok(res, "telegram");
    },
  };
}

export function slack(cfg: Config): Notifier {
  const url = cfg.SLACK_WEBHOOK_URL;
  return {
    name: "slack",
    configured: !!url,
    accepts: () => true,
    async send(n) {
      const res = await fetchWithTimeout(url!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: formatText(n) }) }, 10_000);
      await ok(res, "slack");
    },
  };
}

export function pagerdutyEvent(routingKey: string, a: AlertEvent & { dedupeKey: string }, node: string) {
  return a.status === "resolved"
    ? { routing_key: routingKey, event_action: "resolve", dedup_key: a.dedupeKey }
    : {
        routing_key: routingKey,
        event_action: "trigger",
        dedup_key: a.dedupeKey,
        payload: { summary: `${a.rule} on ${node}: ${a.summary}`.slice(0, 1024), source: node, severity: a.severity === "critical" ? "critical" : "warning", component: "arkiv-node", group: "nodewatch" },
      };
}

export function pagerduty(cfg: Config): Notifier {
  const key = cfg.PAGERDUTY_ROUTING_KEY;
  return {
    name: "pagerduty",
    configured: !!key,
    accepts: (s) => s === "critical",
    async send(n) {
      const events = n.test
        ? [{ routing_key: key, event_action: "trigger", dedup_key: `nodewatch-test-${Date.now()}`, payload: { summary: formatText(n), source: n.node, severity: "info" } }]
        : n.alerts.map((a) => pagerdutyEvent(key!, a, n.node));
      for (const ev of events) {
        const res = await fetchWithTimeout("https://events.pagerduty.com/v2/enqueue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ev) }, 10_000);
        await ok(res, "pagerduty");
      }
    },
  };
}

export function buildNotifiers(cfg: Config): Notifier[] {
  return [telegram(cfg), slack(cfg), pagerduty(cfg)];
}
