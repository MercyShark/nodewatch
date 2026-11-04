import { describe, expect, it } from "vitest";
import { testCtx } from "../test/helpers.js";
import { encodeLabels, ROLLUP_MS } from "./index.js";

describe("tsdb", () => {
  it("encodes labels canonically", () => {
    expect(encodeLabels({ b: "2", a: "1" })).toBe(encodeLabels({ a: "1", b: "2" }));
  });

  it("records, queries raw ranges, and rolls up", () => {
    const { tsdb } = testCtx();
    const now = 10 * 24 * 3600_000;
    for (let i = 0; i < 240; i++) tsdb.record("m", i % 10, { s: "x" }, now - (240 - i) * 15_000);
    tsdb.record("m", Number.NaN, { s: "x" }, now); // dropped
    tsdb.flush();
    const pts = tsdb.query({ metric: "m", labels: { s: "x" }, range: "1h", now });
    expect(pts.length).toBe(240);
    const r = tsdb.rollupAndRetain(now);
    expect(r.rolled).toBeGreaterThan(10);
    const long = tsdb.query({ metric: "m", labels: { s: "x" }, range: "7d", now });
    expect(long.length).toBeGreaterThan(0);
    expect(long.every((p) => p.v >= 0 && p.v <= 9)).toBe(true);
    expect(tsdb.sum("m", { s: "x" }, 3600_000, now)).toBe(240 * 4.5);
    expect(ROLLUP_MS).toBe(300_000);
  });

  it("applies raw retention of 48 h", () => {
    const { tsdb } = testCtx();
    const now = 100 * 3600_000;
    tsdb.record("old", 1, {}, now - 49 * 3600_000);
    tsdb.record("old", 2, {}, now - 1000);
    const r = tsdb.rollupAndRetain(now);
    expect(r.deletedRaw).toBe(1);
    expect(tsdb.latest("old")?.value).toBe(2);
  });
});
