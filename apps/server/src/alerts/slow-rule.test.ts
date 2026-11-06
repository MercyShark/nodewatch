import { describe, expect, it } from "vitest";
import { testCtx } from "../test/helpers.js";
import { DEFAULT_THRESHOLDS, RULES, type RuleInput } from "./rules.js";

describe("SlowRequestCritical", () => {
  const rule = RULES.find((r) => r.name === "SlowRequestCritical")!;
  const input = (slowest: RuleInput["rpc5m"]["slowest"]): RuleInput => ({ ctx: testCtx(), th: DEFAULT_THRESHOLDS, now: Date.now(), rpc5m: { requests: 10, errors: 0, p95Ms: 5, slowest } });
  it("is critical, fires on one request at or over 3 s with the text, and resolves when the window is clean", () => {
    expect(rule.severity).toBe("critical");
    expect(rule.eval(input(undefined))).toBeNull();
    expect(rule.eval(input(null))).toEqual({ active: false, summary: "" });
    expect(rule.eval(input({ ms: 2999, method: "arkiv_query", query: "x = u64(1)", ts: 1 }))).toEqual({ active: false, summary: "" });
    expect(rule.eval(input({ ms: 3450.4, method: "arkiv_query", query: "$expiresAt  >  u64(7)", ts: 1 }))).toEqual({ active: true, summary: "3,450 ms arkiv_query: $expiresAt > u64(7) (limit 3000 ms)" });
    expect(rule.eval(input({ ms: 4000, method: "eth_blockNumber", query: null, ts: 1 }))!.summary).toBe("4,000 ms eth_blockNumber (limit 3000 ms)");
  });
});
