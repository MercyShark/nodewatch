import { describe, expect, it } from "vitest";
import { testCtx } from "../test/helpers.js";
import { LiveQueries } from "../proxy/live.js";
import { formatSlowRequest, MAX_PER_MINUTE, SlowRequestDigest } from "./slow-digest.js";

describe("slow-request notifications", () => {
  it("sends one Telegram message per request over the threshold with metrics and the actual text, never twice, honouring silence", async () => {
    const ctx = testCtx();
    const live = new LiveQueries(ctx, 250);
    const t0 = 1_700_000_000_000;
    const sent: string[] = [];
    let silenced = false;
    const n = new SlowRequestDigest(ctx, "node-1", async (text) => (sent.push(text), { ok: true, error: null }), () => silenced, () => true, t0);
    live.observe("eth_blockNumber", 3, true, false, "[]", t0 + 1000);
    live.observe("arkiv_query", 1204.4, true, false, "kind = str('rpc.offer') AND n > u64(5)", t0 + 2000);
    live.observe("eth_getLogs", 820, false, false, '[{"fromBlock":"0x46000","toBlock":"0x46400"}]', t0 + 3000, { code: -32603, message: "golemdb segment_range_of(transactions): NotImplemented" });
    live.observe("arkiv_query", 749, true, false, "name = str('x')", t0 + 4000); // under 750: not sent
    live.flush(t0 + 5000);

    expect(await n.tick(t0 + 10_000)).toEqual({ sent: 2, heldBack: 0 });
    expect(sent.length).toBe(2);
    expect(sent[0]).toBe("Slow request on node-1: 1,204 ms (limit 750 ms)\narkiv_query · ok · 2023-11-14 22:13:22 UTC\nkind = str('rpc.offer') AND n > u64(5)");
    expect(sent[1]).toBe('Slow request on node-1: 820 ms (limit 750 ms)\neth_getLogs · error: golemdb segment_range_of(transactions): NotImplemented · 2023-11-14 22:13:23 UTC\n[{"fromBlock":"0x46000","toBlock":"0x46400"}]');

    // nothing new → nothing sent
    expect((await n.tick(t0 + 20_000)).sent).toBe(0);
    expect(sent.length).toBe(2);

    // silenced → skipped, and not resent later
    live.observe("arkiv_query", 900, true, false, "$owner = addr(0x1)", t0 + 25_000);
    live.flush(t0 + 26_000);
    silenced = true;
    expect((await n.tick(t0 + 30_000)).sent).toBe(0);
    silenced = false;
    expect((await n.tick(t0 + 40_000)).sent).toBe(0);
    expect(sent.length).toBe(2);
    live.stop();
  });

  it("flood guard: at most 20 messages a minute, then one 'N more' line at the next minute", async () => {
    const ctx = testCtx();
    const live = new LiveQueries(ctx, 250);
    const t0 = 1_700_000_000_000;
    const sent: string[] = [];
    const n = new SlowRequestDigest(ctx, "node-1", async (text) => (sent.push(text), { ok: true, error: null }), () => false, () => true, t0);
    for (let i = 0; i < 25; i++) live.observe("arkiv_query", 1000 + i, true, false, `$expiresAt > u64(${i})`, t0 + 1000 + i);
    live.flush(t0 + 2000);
    expect(await n.tick(t0 + 10_000)).toEqual({ sent: MAX_PER_MINUTE, heldBack: 5 });
    expect(sent.length).toBe(20);
    // same minute: still capped
    live.observe("arkiv_query", 2000, true, false, "$owner = addr(0x2)", t0 + 15_000);
    live.flush(t0 + 16_000);
    expect(await n.tick(t0 + 20_000)).toEqual({ sent: 0, heldBack: 1 });
    // next minute: the overflow line, then sending resumes
    live.observe("arkiv_query", 3000, true, false, "$owner = addr(0x3)", t0 + 61_000);
    live.flush(t0 + 62_000);
    expect(await n.tick(t0 + 70_000)).toEqual({ sent: 1, heldBack: 0 });
    expect(sent[20]).toBe("Nodewatch on node-1: 6 more requests over 750 ms in the last minute. The Live queries page has all of them.");
    expect(sent[21]).toContain("3,000 ms");
    expect(sent[21]).toContain("$owner = addr(0x3)");
    live.stop();
  });

  it("formats long text and missing parameters", () => {
    const t = formatSlowRequest("n", { ts: 0, method: "eth_call", ms: 999.6, ok: 1, error_message: null, query: "x".repeat(2000) }, 750);
    expect(t).toContain("1,000 ms");
    expect(t).toContain("x".repeat(1500) + "…");
    expect(formatSlowRequest("n", { ts: 0, method: "eth_blockNumber", ms: 800, ok: 1, error_message: null, query: null }, 750)).toContain("(no parameters)");
  });
});
