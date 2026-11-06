import { describe, expect, it } from "vitest";
import { testCtx } from "../test/helpers.js";
import { LiveQueries } from "../proxy/live.js";
import { formatDigest, SlowRequestDigest } from "./slow-digest.js";

describe("slow-request digest", () => {
  it("sends one message a minute with every request over the threshold, never twice, and respects silence", async () => {
    const ctx = testCtx();
    const live = new LiveQueries(ctx, 250);
    const t0 = 1_700_000_000_000;
    const sent: string[] = [];
    let silenced = false;
    const digest = new SlowRequestDigest(ctx, "node-1", async (text) => (sent.push(text), { ok: true, error: null }), () => silenced, () => true, t0);
    live.observe("eth_blockNumber", 3, true, false, "[]", t0 + 1000);
    live.observe("arkiv_query", 1204.4, true, false, "kind = str('rpc.offer') AND n > u64(5)", t0 + 2000);
    live.observe("eth_getLogs", 820, false, false, '[{"fromBlock":"0x46000","toBlock":"0x46400"}]', t0 + 3000, { code: -32603, message: "golemdb segment_range_of(transactions): NotImplemented" });
    live.observe("arkiv_query", 749, true, false, "name = str('x')", t0 + 4000); // under 750: not included
    live.flush(t0 + 5000);

    expect((await digest.tick(t0 + 60_000)).sent).toBe(2);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("Nodewatch on node-1: 2 requests over 750 ms in the last 60 s");
    expect(sent[0]).toContain("• 1,204 ms arkiv_query kind = str('rpc.offer') AND n > u64(5)");
    expect(sent[0]).toContain("• 820 ms eth_getLogs [{\"fromBlock\":\"0x46000\",\"toBlock\":\"0x46400\"}] → golemdb segment_range_of(transactions): NotImplemented");
    expect(sent[0]).not.toContain("name = str");

    // nothing new → nothing sent
    expect((await digest.tick(t0 + 120_000)).sent).toBe(0);
    expect(sent.length).toBe(1);

    // silenced → skipped, and not resent later
    live.observe("arkiv_query", 900, true, false, "$owner = addr(0x1)", t0 + 130_000);
    live.flush(t0 + 131_000);
    silenced = true;
    expect((await digest.tick(t0 + 180_000)).sent).toBe(0);
    silenced = false;
    expect((await digest.tick(t0 + 240_000)).sent).toBe(0);
    expect(sent.length).toBe(1);
    live.stop();
  });

  it("caps the message at 8 lines and shortens long text", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ts: i, method: "arkiv_query", ms: 1000 + i, ok: 1, error_message: null, query: "x".repeat(400) }));
    const text = formatDigest("n", rows, 750, 60);
    expect(text.split("\n").length).toBe(10); // head + 8 + "and 2 more"
    expect(text).toContain("… and 2 more");
    expect(text).toContain("x".repeat(160) + "…");
  });
});
