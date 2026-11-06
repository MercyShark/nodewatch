import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@nodewatch/shared";
import { testCtx } from "../test/helpers.js";
import { LiveQueries, percentileOf, shapeTextFor } from "./live.js";
import { shapeId } from "./shape.js";

describe("LiveQueries", () => {
  it("keeps a recent ring, batches SSE events, and persists shapes and slow requests", async () => {
    const ctx = testCtx();
    const events: StreamEvent[] = [];
    ctx.bus.on("stream", (ev: StreamEvent) => events.push(ev));
    const live = new LiveQueries(ctx, 250);
    const t0 = 1_700_000_000_000;
    const qa = "kind = str('rpc.offer') AND n > u64(5)";
    const qb = "kind = str('rpc.listing') AND n > u64(9)"; // same shape as qa
    live.observe("arkiv_query", 12, true, false, qa, t0);
    live.observe("arkiv_query", 300, true, false, qb, t0 + 1000);
    live.observe("arkiv_query", 40, false, true, "$owner = addr(0x1)", t0 + 2000);
    live.observe("eth_blockNumber", 3, true, false, null, t0 + 3000);
    live.observe("eth_call", 900, false, false, null, t0 + 4000, { code: -32603, message: "golemdb segment_range_of(transactions): NotImplemented" });
    live.observe("eth_call", 20, false, false, null, t0 + 4500, { code: -32602, message: "query exceeds max block range 100000" });
    expect(live.errors().find((e) => e.method === "eth_call")).toEqual({ method: "eth_call", count: 2, lastCode: -32602, lastMessage: "query exceeds max block range 100000", lastAt: t0 + 4500 });
    expect(live.errors()[0]!.method).toBe("eth_call"); // most errors first

    const recent = live.recent(3);
    expect(recent.map((r) => r.method)).toEqual(["eth_call", "eth_call", "eth_blockNumber"]);
    expect(live.recent(4)[3]!.shapeId).toBe(shapeId("$owner = addr(0x2)"));
    expect(recent.every((r) => !("query" in r))).toBe(true);
    expect(live.recent(4, true)[3]!.query).toBe("$owner = addr(0x1)"); // raw text only when asked (admin)
    expect(live.recent(3, true)[0]!.query).toBeNull();

    await new Promise((r) => setTimeout(r, 1100));
    expect(events.length).toBe(1);
    expect(events[0]!.event).toBe("rpc");
    expect((events[0] as { data: unknown[] }).data.length).toBe(6);

    live.flush(t0 + 5000);
    const shapes = live.shapes(60_000, 50, t0 + 5000);
    expect(shapes.length).toBe(2);
    const s = shapes.find((x) => x.shapeId === shapeId(qa))!;
    expect(s.shape).toBe("kind = str(?) AND n > u64(?)");
    expect(s.count).toBe(2);
    expect(s.errors).toBe(0);
    expect(s.avgMs).toBe(156);
    expect(s.maxMs).toBe(300);
    expect(s.maxAt).toBe(t0 + 1000);
    expect(s.p95Ms).toBe(300);
    expect(shapes[0]!.shapeId).toBe(s.shapeId); // slowest first
    const other = shapes.find((x) => x.shapeId !== s.shapeId)!;
    expect(other.errors).toBe(1);

    // Counters accumulate across flushes; percentiles come from the reservoir.
    live.observe("arkiv_query", 20, true, false, qa, t0 + 6000);
    live.flush(t0 + 7000);
    expect(live.shapes(60_000, 50, t0 + 7000).find((x) => x.shapeId === s.shapeId)!.count).toBe(3);

    const slow = live.slowest(60_000, 10, t0 + 7000);
    expect(slow.map((x) => [x.method, x.ms])).toEqual([
      ["eth_call", 900],
      ["arkiv_query", 300],
    ]);
    expect(slow[1]!.shape).toBe("kind = str(?) AND n > u64(?)");
    expect("query" in slow[1]!).toBe(false);
    expect(live.slowest(60_000, 10, t0 + 7000, true)[1]!.query).toBe(qb); // memory only, admin only
    expect(slow[0]!.ok).toBe(false);

    // Out of range → nothing.
    expect(live.shapes(1000, 50, t0 + 100_000)).toEqual([]);
    expect(live.slowest(1000, 10, t0 + 100_000)).toEqual([]);
    live.stop();
  });

  it("never stores the text of something that is not a query", () => {
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
