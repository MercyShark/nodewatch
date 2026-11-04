import type { Severity } from "@nodewatch/shared";
import { describe, expect, it } from "vitest";
import { testCtx } from "../test/helpers.js";
import { AlertEngine } from "./engine.js";
import type { Notification, Notifier } from "./notifiers/index.js";
import { pagerdutyEvent } from "./notifiers/index.js";
import type { Rule } from "./rules.js";

function fakeNotifier(name: "telegram" | "pagerduty", accepts: (s: Severity) => boolean, failTimes = 0) {
  const sent: Notification[] = [];
  let fails = failTimes;
  const n: Notifier = {
    name,
    configured: true,
    accepts,
    async send(msg) {
      if (fails-- > 0) throw new Error("boom");
      sent.push(msg);
    },
  };
  return { n, sent };
}

describe("alert engine", () => {
  it("goes pending → firing → resolved, groups, inhibits and honours silences", async () => {
    const ctx = testCtx({ INSTANCE_NAME: "node1" });
    let downActive = false;
    let lagActive = false;
    const rules: Rule[] = [
      { name: "ContainerDown", severity: "critical", forMs: 60_000, inhibits: ["NodeLagging"], eval: () => ({ active: downActive, summary: "down" }) },
      { name: "NodeLagging", severity: "warning", forMs: 0, eval: () => ({ active: lagActive, summary: "lag" }) },
      { name: "NoData", severity: "warning", forMs: 0, eval: () => null },
    ];
    const tg = fakeNotifier("telegram", () => true, 1);
    const pd = fakeNotifier("pagerduty", (s) => s === "critical");
    const eng = new AlertEngine(ctx, () => ({ requests: 0, errors: 0, p95Ms: null }), {
      rules,
      notifiers: [tg.n, pd.n],
      groupWaitMs: 10,
      retryBaseMs: 1,
    });
    const t0 = Date.now() - 3600_000;
    downActive = true;
    lagActive = true;
    eng.evaluate(t0);
    expect(eng.active().length).toBe(0); // ContainerDown pending, NodeLagging inhibited
    eng.evaluate(t0 + 61_000);
    expect(eng.active().map((a) => a.rule)).toEqual(["ContainerDown"]);
    await eng.flushGroup();
    expect(tg.sent.length).toBe(1); // after one retry
    expect(pd.sent[0]!.alerts[0]!.dedupeKey).toBe("ContainerDown:node1");
    downActive = false;
    eng.evaluate(t0 + 70_000);
    expect(eng.active().map((a) => a.rule)).toEqual(["NodeLagging"]); // no longer inhibited
    await eng.flushGroup();
    const last = tg.sent[tg.sent.length - 1]!;
    expect(last.alerts.map((a) => `${a.rule}:${a.status}`).sort()).toEqual(["ContainerDown:resolved", "NodeLagging:firing"]);
    expect(pd.sent[pd.sent.length - 1]!.alerts.map((a) => a.status)).toEqual(["resolved"]);

    eng.addSilence(null, 10, "test");
    lagActive = false;
    const before = tg.sent.length;
    eng.evaluate(Date.now());
    await eng.flushGroup();
    expect(tg.sent.length).toBe(before); // silenced
    const resp = eng.response();
    expect(resp.history.length).toBe(2);
    expect(resp.silences.length).toBe(1);
    const log = ctx.db.prepare("SELECT COUNT(*) AS n FROM alerts_log").get() as { n: number };
    expect(log.n).toBeGreaterThanOrEqual(3);
  });

  it("builds PagerDuty v2 trigger and resolve events", () => {
    const a = { id: "1", rule: "R", severity: "critical" as const, status: "firing" as const, summary: "s", startedAt: 1, resolvedAt: null, dedupeKey: "R:n" };
    expect(pagerdutyEvent("k", a, "n")).toMatchObject({ event_action: "trigger", dedup_key: "R:n", payload: { severity: "critical" } });
    expect(pagerdutyEvent("k", { ...a, status: "resolved" }, "n")).toEqual({ routing_key: "k", event_action: "resolve", dedup_key: "R:n" });
  });
});
