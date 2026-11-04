import { describe, expect, it } from "vitest";
import { fitK, percentiles, scaling } from "./analyze.js";
import { assertBenchTarget } from "./guard.js";
import { itemValues } from "./dataset.js";
import { BENCH_SHAPES, idOf, MARKETPLACE_SHAPES } from "./shapes.js";

const cfg = { EL_RPC_URL: "http://127.0.0.1:8545", BENCH_SANDBOX_PORT: 28545 };

describe("bench guard", () => {
  it("allows only our node and the sandbox", () => {
    expect(assertBenchTarget(cfg, "http://127.0.0.1:8545")).toBeTruthy();
    expect(assertBenchTarget(cfg, "http://localhost:8545/")).toBeTruthy();
    expect(assertBenchTarget(cfg, "http://127.0.0.1:28545")).toBeTruthy();
    for (const u of ["https://rpc.rabdi.db-chain.testnet.arkiv.network", "http://127.0.0.1:8546", "http://10.0.0.5:8545", "not a url"]) {
      expect(() => assertBenchTarget(cfg, u)).toThrow(/refused/);
    }
  });
});

describe("bench analysis", () => {
  it("computes percentiles", () => {
    const p = percentiles(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(p).toEqual({ p50: 50, p95: 95, p99: 99 });
  });
  it("fits the log-log slope", () => {
    expect(fitK([{ size: 100, p95: 10 }, { size: 1000, p95: 100 }, { size: 10000, p95: 1000 }])).toBeCloseTo(1, 3);
    expect(fitK([{ size: 100, p95: 10 }, { size: 1000, p95: 10 }])).toBeCloseTo(0, 3);
    expect(fitK([{ size: 100, p95: 10 }])).toBe(0);
  });
  it("flags slow shapes", () => {
    const sc = scaling([
      { shapeId: "a", size: 500, p95Ms: 5 }, { shapeId: "a", size: 5000, p95Ms: 6 },
      { shapeId: "b", size: 500, p95Ms: 1 }, { shapeId: "b", size: 5000, p95Ms: 40 },
      { shapeId: "c", size: 500, p95Ms: 200 }, { shapeId: "c", size: 5000, p95Ms: 300 },
    ]);
    expect(sc.find((s) => s.shapeId === "a")!.slow).toBe(false);
    expect(sc.find((s) => s.shapeId === "b")!.slow).toBe(true);
    expect(sc.find((s) => s.shapeId === "c")!.slow).toBe(true);
  });
});

describe("shape catalog", () => {
  it("has unique ids stable across sizes", () => {
    const p = (size: number) => ({ size, runTag: "rabc", bench: "0x" + "1".repeat(40), lb: "0x" + "2".repeat(40) });
    for (const cat of [BENCH_SHAPES, MARKETPLACE_SHAPES]) {
      const ids = cat.map((s) => idOf(s, s.render(p(500))));
      expect(new Set(ids).size).toBe(ids.length);
      expect(cat.map((s) => idOf(s, s.render(p(5000))))).toEqual(ids);
    }
  });
});

describe("seeded dataset", () => {
  it("has rows matching the full 5-term AND chain at every default size", () => {
    const bench = "0x" + "9".repeat(40);
    for (const size of [500, 1000, 2500, 5000]) {
      let hits = 0;
      for (let i = 0; i < size; i++) {
        const v = itemValues(i, "rtest", bench);
        const n = Number(v.n.value ?? v.n);
        const score = Number(v.score.value ?? v.score);
        const owner = String(v.owner.value ?? v.owner).toLowerCase();
        if (v.cat === "c4" && n > Math.floor(size / 4) && score < 80 && v.tag.startsWith("t") && owner === bench) hits++;
      }
      expect(hits).toBeGreaterThan(0);
    }
  });
});
