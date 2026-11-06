import { describe, expect, it, vi } from "vitest";

const TOKEN = "123456789:AAH-secret-token-value_abcdefghijklmno";
const sent: { url: string; body: Record<string, unknown> }[] = [];
vi.mock("../../util/http.js", () => ({
  fetchWithTimeout: vi.fn(async (url: string, init: { body: string }) => {
    if (url.includes("pagerduty")) {
      sent.push({ url, body: JSON.parse(init.body) });
      return new Response('{"status":"success"}', { status: 202 });
    }
    throw new Error(`request to ${url} failed, reason: connect ETIMEDOUT`);
  }),
}));

const { buildNotifiers, pagerduty, slack, telegram } = await import("./index.js");
const cfg = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "42", PAGERDUTY_ROUTING_KEY: undefined } as never;

describe("telegram notifier", () => {
  it("never puts the bot token in an error message", async () => {
    const err = await telegram(cfg)
      .send({ alerts: [], node: "n1", test: true })
      .catch((e: Error) => e);
    expect(String(err)).toContain("<bot-token>");
    expect(String(err)).not.toContain(TOKEN);
  });

  it("builds Telegram, PagerDuty and Slack channels", () => {
    expect(buildNotifiers(cfg).map((n) => n.name)).toEqual(["telegram", "pagerduty", "slack"]);
    expect(telegram(cfg).configured).toBe(true);
  });

  it("PagerDuty test opens an incident and resolves it again", async () => {
    await pagerduty({ PAGERDUTY_ROUTING_KEY: "k".repeat(32) } as never).send({ alerts: [], node: "n1", test: true });
    expect(sent.map((e) => e.body.event_action)).toEqual(["trigger", "resolve"]);
    expect(sent[0]!.body.dedup_key).toBe(sent[1]!.body.dedup_key);
  });
});

describe("slack notifier", () => {
  it("posts the digest text to the webhook and hides the URL in errors", async () => {
    const { fetchWithTimeout } = await import("../../util/http.js");
    const fx = vi.mocked(fetchWithTimeout);
    const slackCfg = { SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T0/B0/secret", SLACK_ALERTS: "none" as const };
    const calls: { url: string; body: string }[] = [];
    fx.mockImplementationOnce(async (url: string, init?: { body?: unknown }) => {
      calls.push({ url, body: String(init?.body) });
      return new Response("ok", { status: 200 });
    });
    const n = slack(slackCfg as never);
    expect(n.configured).toBe(true);
    expect(n.accepts("critical")).toBe(false); // SLACK_ALERTS=none: digest only
    await n.send({ alerts: [], node: "n", text: "Nodewatch on n: 1 request over 750 ms" });
    expect(calls[0]!.url).toBe("https://hooks.slack.com/services/T0/B0/secret");
    expect(JSON.parse(calls[0]!.body)).toEqual({ text: "Nodewatch on n: 1 request over 750 ms" });
    fx.mockImplementationOnce(async () => new Response("no_service", { status: 404 }));
    await expect(n.send({ alerts: [], node: "n", test: true })).rejects.toThrow(/slack: HTTP 404/);
    fx.mockImplementationOnce(async () => {
      throw new Error("request to https://hooks.slack.com/services/T0/B0/secret failed");
    });
    await expect(n.send({ alerts: [], node: "n", test: true })).rejects.toThrow(/<webhook-url>/);
    expect(slack({ ...slackCfg, SLACK_ALERTS: "critical" } as never).accepts("critical")).toBe(true);
    expect(buildNotifiers({ ...(cfg as object), ...slackCfg } as never).map((x) => x.name)).toEqual(["telegram", "pagerduty", "slack"]);
  });
});
