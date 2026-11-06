import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@nodewatch/shared";
import { testCtx } from "../test/helpers.js";
import { LiveQueries, percentileOf, shapeTextFor, stripText } from "./live.js";
import { shapeId } from "./shape.js";

describe("LiveQueries", () => {
  it("logs every request with its text, batches SSE events, and keeps shapes, slowest and errors across reads", async () => {
    const ctx = testCtx();
    const events: StreamEvent[] = [];
    ctx.bus.on("stream", (ev: StreamEvent) => events.push(ev));
    const live = new LiveQueries(ctx, 250);
    const t0 = 1_700_000_000_000;
    const qa = "kind = str('rpc.offer') AND n > u64(5)";
    const qb = "kind = str('rpc.listing') AND n > u64(9)"; // same shape as qa
    live.observe("arkiv_query", 12, true, false, qa, t0);
    live.observe("arkiv_query", 300, true, false, qb, t0 + 1000);
    live.observe("arkiv_query", 40, false, true, "$owner = addr(0x1)", t0 + 2000, { code: -32001, message: "expected a comparison operator" });
    live.observe("eth_blockNumber", 3, true, false, "[]", t0 + 3000);
    live.observe("eth_getLogs", 900, false, false, '[{"fromBlock":"0x46000","toBlock":"0x46400"}]', t0 + 4000, { code: -32603, message: "golemdb segment_range_of(transactions): NotImplemented" });
    live.observe("eth_getLogs", 20, false, false, '[{"fromBlock":"0x1","toBlock":"0x2"}]', t0 + 4500, { code: -32603, message: "golemdb segment_range_of(transactions): NotImplemented" });

    await new Promise((r) => setTimeout(r, 1100));
    expect(events.length).toBe(1);
    expect(events[0]!.event).toBe("rpc");
    const batch = (events[0] as { data: { query?: string | null; error?: string | null }[] }).data;
    expect(batch.length).toBe(6);
    expect(batch[4]!.query).toBe('[{"fromBlock":"0x46000","toBlock":"0x46400"}]'); // admins get it; the stream route strips it for viewers
    expect(stripText(batch[4]!)).not.toHaveProperty("query");
    expect(batch[4]!.error).toContain("NotImplemented");

    // recent: from the log, newest first, text only when asked
    const recent = live.recent(3, false, t0 + 5000);
    expect(recent.map((r) => r.method)).toEqual(["eth_getLogs", "eth_getLogs", "eth_blockNumber"]);
    expect(recent.every((r) => !("query" in r))).toBe(true);
    expect(live.recent(6, true, t0 + 5000)[5]!.query).toBe(qa);

    const shapes = live.shapes(60_000, 50, t0 + 5000, true);
    expect(shapes.length).toBe(2);
    const s = shapes.find((x) => x.shapeId === shapeId(qa))!;
    expect(s.shape).toBe("kind = str(?) AND n > u64(?)");
    expect(s.sample).toBe(qb); // latest example
    expect(s.count).toBe(2);
    expect(s.avgMs).toBe(156);
    expect(s.maxMs).toBe(300);
    expect(s.p95Ms).toBe(300);
    expect(shapes[0]!.shapeId).toBe(s.shapeId); // slowest first
    expect(live.shapes(60_000, 50, t0 + 5000)[0]).not.toHaveProperty("sample");

    // counters accumulate across flushes
    live.observe("arkiv_query", 20, true, false, qa, t0 + 6000);
    expect(live.shapes(60_000, 50, t0 + 7000).find((x) => x.shapeId === s.shapeId)!.count).toBe(3);

    const slow = live.slowest(60_000, 10, t0 + 7000, true);
    expect(slow.map((x) => [x.method, x.ms])).toEqual([
      ["eth_getLogs", 900],
      ["arkiv_query", 300],
    ]);
    expect(slow[0]!.query).toContain("0x46000");
    expect(slow[0]!.error).toContain("NotImplemented");
    expect(slow[1]!.shape).toBe("kind = str(?) AND n > u64(?)");
    expect(live.slowest(60_000, 10, t0 + 7000)[0]).not.toHaveProperty("query");

    const errors = live.errors(60_000, t0 + 7000);
    expect(errors[0]).toEqual({ method: "eth_getLogs", count: 2, lastCode: -32603, lastMessage: "golemdb segment_range_of(transactions): NotImplemented", lastAt: t0 + 4500 });
    expect(errors[1]!.method).toBe("arkiv_query");

    // Out of range → nothing; the log survives a new instance (same db)
    expect(live.shapes(1000, 50, t0 + 100_000)).toEqual([]);
    expect(live.slowest(1000, 10, t0 + 100_000)).toEqual([]);
    const again = new LiveQueries(ctx, 250);
    expect(again.recent(2, true, t0 + 8000)[0]!.method).toBe("arkiv_query");
    expect(again.recent(2, true, t0 + 8000)[0]!.query).toBe(qa);
    live.stop();
  });

  it("never keeps the text of something that is not a query as a shape", () => {
    expect(shapeTextFor("kind = str('x') AND n > u64(5)")).toBe("kind = str(?) AND n > u64(?)");
    expect(shapeTextFor("$owner = addr(0xabc) ORDER BY n DESC LIMIT 10")).toBe("$owner = addr(?) ORDER BY n DESC LIMIT ?");
    expect(shapeTextFor("this is not a query ((")).toBe("(unparsed query)");
    expect(shapeTextFor("please return all entities owned by 0xabc")).toBe("(unparsed query)");
    expect(shapeTextFor("")).toBe("(unparsed query)");
  });

  it("percentiles", () => {
    expect(percentileOf([], 95)).toBeNull();
    expect(percentileOf([5, 1, 3], 50)).toBe(3);
    expect(percentileOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});
