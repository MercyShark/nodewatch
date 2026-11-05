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

const { buildNotifiers, pagerduty, telegram } = await import("./index.js");
const cfg = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "42", PAGERDUTY_ROUTING_KEY: undefined } as never;

describe("telegram notifier", () => {
  it("never puts the bot token in an error message", async () => {
    const err = await telegram(cfg)
      .send({ alerts: [], node: "n1", test: true })
      .catch((e: Error) => e);
    expect(String(err)).toContain("<bot-token>");
    expect(String(err)).not.toContain(TOKEN);
  });

  it("is the only chat channel: Telegram and PagerDuty, no Slack", () => {
    expect(buildNotifiers(cfg).map((n) => n.name)).toEqual(["telegram", "pagerduty"]);
    expect(telegram(cfg).configured).toBe(true);
  });

  it("PagerDuty test opens an incident and resolves it again", async () => {
    await pagerduty({ PAGERDUTY_ROUTING_KEY: "k".repeat(32) } as never).send({ alerts: [], node: "n1", test: true });
    expect(sent.map((e) => e.body.event_action)).toEqual(["trigger", "resolve"]);
    expect(sent[0]!.body.dedup_key).toBe(sent[1]!.body.dedup_key);
  });
});
