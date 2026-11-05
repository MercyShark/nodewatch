import { describe, expect, it } from "vitest";
import { fitK, percentiles, scaling } from "./analyze.js";
import { assertBenchTarget } from "./guard.js";
import { itemValues } from "./dataset.js";
import { BENCH_SHAPE_NOTES } from "@nodewatch/shared";
import { stats } from "./analyze.js";
import { BENCH_SHAPES, catalogShapes, idOf, MARKETPLACE_SHAPES } from "./shapes.js";

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

describe("shape catalog", () => {
  const lb = "0xCA4B000000000000000000000000000000000001";
  it("gives every shape a unique id that matches the ids real runs store, at any size and run", () => {
    const cat = catalogShapes(lb, true);
    expect(new Set(cat.map((c) => c.id)).size).toBe(cat.length);
    const byName = new Map(cat.map((c) => [c.name, c.id]));
    for (const shape of [...BENCH_SHAPES, ...MARKETPLACE_SHAPES]) {
      for (const p of [
        { size: 500, runTag: "r1234abcd", bench: "0x1111111111111111111111111111111111111111", lb },
        { size: 50_000, runTag: "rffff0000", bench: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", lb },
      ]) {
        expect(idOf(shape, shape.render(p)), shape.name).toBe(byName.get(shape.name));
      }
    }
  });

  it("assigns datasets, documents every shape and hides templates unless asked", () => {
    const cat = catalogShapes(lb, false);
    expect(cat.filter((c) => c.dataset === "synthetic")).toHaveLength(BENCH_SHAPES.length);
    expect(cat.filter((c) => c.dataset === "marketplace")).toHaveLength(MARKETPLACE_SHAPES.length);
    for (const c of cat) {
      expect(BENCH_SHAPE_NOTES[c.name], c.name).toBeTruthy();
      expect(c.template).toBeNull();
    }
    expect(catalogShapes(lb, true).every((c) => typeof c.template === "string" && c.template.length > 0)).toBe(true);
  });

  it("summarises samples", () => {
    expect(stats([])).toBeNull();
    expect(stats([2, 4, 4, 4, 5, 5, 7, 9])).toMatchObject({ minMs: 2, maxMs: 9, meanMs: 5, stdMs: 2.14, samples: [2, 4, 4, 4, 5, 5, 7, 9] });
  });
});
