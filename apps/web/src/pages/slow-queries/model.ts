// Derived view of a slow-query run: joins results with the shape catalog, fits each shape, ranks risk.
import {
  fitPower,
  project,
  SLOW_K,
  SLOW_P95_MS,
  type BenchCatalog,
  type BenchResult,
  type BenchRun,
  type BenchShapeInfo,
  type PowerFit,
} from "@nodewatch/shared";

export const ACTIVE: BenchRun["status"][] = ["queued", "seeding", "running", "paused"];
export const PROJECT_SIZES = [10_000, 50_000, 100_000];

export const ms = (v: number) => (v >= 100 ? Math.round(v).toLocaleString("en-US") : v >= 10 ? v.toFixed(1) : v.toFixed(2));

export interface ShapeView {
  id: string;
  /** Stable number from the catalog order: the only identity shown in demo-safe mode. */
  num: number;
  info: BenchShapeInfo | null;
  /** Display name, already respecting demo-safe mode. */
  name: string;
  family: string | null;
  results: BenchResult[];
  fit: PowerFit | null;
  k: number | null;
  largest: BenchResult | null;
  slow: boolean;
  /** max(p95 / 250 ms, k / 1.2): ≥ 1 means slow; used to rank what to look at first. */
  risk: number;
  /** p95 at the largest size divided by p95 at the smallest. */
  growth: number | null;
}

export interface FamilyView {
  id: string;
  label: string;
  shapes: ShapeView[];
  medianP95: number;
  maxP95: number;
  medianK: number | null;
  maxK: number | null;
  slow: number;
}

export interface RunModel {
  run: BenchRun;
  sizes: number[];
  largest: number;
  shapes: ShapeView[];
  byId: Map<string, ShapeView>;
  families: FamilyView[];
  totals: {
    measurements: number;
    samples: number;
    errors: number;
    zeroRows: number;
    slow: number;
    worst: ShapeView | null;
    medianP95: number;
    maxK: ShapeView | null;
    bytesMax: number;
    seedMs: number | null;
    measureMs: number | null;
    durationMs: number | null;
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Number every catalog shape once (#1…#N); unknown ids follow after. */
export function numbering(catalog: BenchCatalog | undefined) {
  const map = new Map<string, number>();
  catalog?.shapes.forEach((s, i) => map.set(s.id, i + 1));
  return (id: string) => {
    if (!map.has(id)) map.set(id, map.size + 1);
    return map.get(id)!;
  };
}

export function displayName(num: number, info: BenchShapeInfo | null, safe: boolean): string {
  if (safe || !info) return `shape #${num}`;
  return `#${num} ${info.name}`;
}

export function buildRun(run: BenchRun, catalog: BenchCatalog | undefined, safe: boolean): RunModel | null {
  if (!run.results.length) return null;
  const num = numbering(catalog);
  const infoById = new Map(catalog?.shapes.map((s) => [s.id, s]) ?? []);
  const scaling = new Map(run.scaling.map((s) => [s.shapeId, s]));
  const sizes = [...new Set(run.results.map((r) => r.size))].sort((a, b) => a - b);
  const largest = sizes[sizes.length - 1]!;
  const grouped = new Map<string, BenchResult[]>();
  for (const r of run.results) grouped.set(r.shapeId, [...(grouped.get(r.shapeId) ?? []), r]);

  const shapes: ShapeView[] = [...grouped.entries()].map(([id, results]) => {
    results.sort((a, b) => a.size - b.size);
    const info = infoById.get(id) ?? null;
    const n = num(id);
    const fit = fitPower(results.map((r) => ({ x: r.size, y: r.p95Ms })));
    const big = results.find((r) => r.size === largest) ?? null;
    const sc = scaling.get(id);
    // One size cannot show growth: k is unknown, not 0.
    const k = sizes.length > 1 ? (sc?.k ?? fit?.k ?? null) : null;
    const slow = sc?.slow ?? ((big?.p95Ms ?? 0) > SLOW_P95_MS || (k ?? 0) > SLOW_K);
    const first = results[0]!;
    return {
      id,
      num: n,
      info,
      name: displayName(n, info, safe),
      family: safe ? null : (info?.family ?? results[0]?.family ?? null),
      results,
      fit,
      k,
      largest: big,
      slow,
      risk: Math.max((big?.p95Ms ?? 0) / SLOW_P95_MS, sizes.length > 1 ? (k ?? 0) / SLOW_K : 0),
      growth: big && results.length > 1 && first.p95Ms > 0 ? big.p95Ms / first.p95Ms : null,
    };
  });
  shapes.sort((a, b) => a.num - b.num);
  const byId = new Map(shapes.map((s) => [s.id, s]));

  const famLabel = new Map(catalog?.families.map((f) => [f.id, f.label]) ?? []);
  const famMap = new Map<string, ShapeView[]>();
  for (const s of shapes) if (s.family) famMap.set(s.family, [...(famMap.get(s.family) ?? []), s]);
  const familyOrder = catalog?.families.map((f) => f.id) ?? [];
  const families: FamilyView[] = [...famMap.entries()]
    .map(([id, list]) => {
      const p95s = list.map((s) => s.largest?.p95Ms ?? 0);
      const ks = list.map((s) => s.k).filter((k): k is number => k != null);
      return {
        id,
        label: famLabel.get(id) ?? id,
        shapes: list,
        medianP95: median(p95s),
        maxP95: Math.max(...p95s),
        medianK: ks.length && sizes.length > 1 ? median(ks) : null,
        maxK: ks.length && sizes.length > 1 ? Math.max(...ks) : null,
        slow: list.filter((s) => s.slow).length,
      };
    })
    .sort((a, b) => familyOrder.indexOf(a.id) - familyOrder.indexOf(b.id));

  const atLargest = shapes.filter((s) => s.largest);
  const worst = atLargest.reduce<ShapeView | null>((w, s) => (!w || s.largest!.p95Ms > w.largest!.p95Ms ? s : w), null);
  const maxK = sizes.length > 1 ? shapes.reduce<ShapeView | null>((w, s) => (s.k != null && (!w || s.k > (w.k ?? -Infinity)) ? s : w), null) : null;
  const meta = run.meta;
  const perShape = meta ? meta.runsPerShape - meta.warmupRuns : null;
  return {
    run,
    sizes,
    largest,
    shapes,
    byId,
    families,
    totals: {
      measurements: run.results.length,
      samples: run.results.reduce((a, r) => a + (r.stats?.samples.length ?? perShape ?? 0), 0),
      errors: run.results.reduce((a, r) => a + r.errors, 0),
      zeroRows: run.results.filter((r) => r.rows === 0).length,
      slow: shapes.filter((s) => s.slow).length,
      worst,
      medianP95: median(atLargest.map((s) => s.largest!.p95Ms)),
      maxK,
      bytesMax: Math.max(0, ...run.results.map((r) => r.bytes ?? 0)),
      seedMs: meta ? meta.seed.reduce((a, s) => a + s.ms, 0) : null,
      measureMs: meta ? meta.measure.reduce((a, s) => a + s.ms, 0) : null,
      durationMs: run.finishedAt ? run.finishedAt - run.startedAt : null,
    },
  };
}

/** Projected p95 at bigger sizes from the fit. A hint for where to look, not a measurement. */
export function projections(s: ShapeView): { size: number; p95: number }[] {
  if (!s.fit || s.results.length < 2) return [];
  const maxMeasured = s.results[s.results.length - 1]!.size;
  return PROJECT_SIZES.filter((n) => n > maxMeasured).map((size) => ({ size, p95: project(s.fit!, size) }));
}

/** Size at which the fit crosses the slow line, if it ever does within 10M entities. */
export function crossesSlowAt(s: ShapeView): number | null {
  if (!s.fit || s.fit.k <= 0 || s.results.length < 2) return null;
  const n = (SLOW_P95_MS / s.fit.a) ** (1 / s.fit.k);
  return Number.isFinite(n) && n < 1e7 ? n : null;
}

export function kWords(k: number | null): { text: string; tone: "ok" | "warn" | "crit" | "neutral" } {
  if (k == null) return { text: "needs ≥ 2 sizes", tone: "neutral" };
  if (k < 0.3) return { text: "flat: barely changes as data grows", tone: "ok" };
  if (k < 0.8) return { text: "sub-linear: grows slower than the data", tone: "ok" };
  if (k <= SLOW_K) return { text: "about linear: time follows the data", tone: "warn" };
  return { text: "super-linear: grows faster than the data", tone: "crit" };
}


export interface CoverageCell {
  p95: number;
  runId: string;
  startedAt: number;
  slow: boolean;
}

/** For every catalog shape: the latest measured p95 per dataset size, across all finished runs. */
export function coverage(runs: BenchRun[]) {
  const done = runs.filter((r) => r.status === "done").sort((a, b) => b.startedAt - a.startedAt);
  const synthSizes = new Set<number>();
  const marketSizes = new Set<number>();
  const cells = new Map<string, CoverageCell>(); // `${id}|${size}`
  const marketplace = new Map<string, CoverageCell & { size: number }>();
  const runsPerShape = new Map<string, number>();
  for (const run of done) {
    const slowIds = new Set(run.scaling.filter((s) => s.slow).map((s) => s.shapeId));
    for (const r of run.results) {
      const synthetic = run.target !== "readonly";
      const cell = { p95: r.p95Ms, runId: run.id, startedAt: run.startedAt, slow: slowIds.has(r.shapeId) || r.p95Ms > SLOW_P95_MS };
      if (synthetic) {
        synthSizes.add(r.size);
        const key = `${r.shapeId}|${r.size}`;
        if (!cells.has(key)) cells.set(key, cell);
      } else {
        marketSizes.add(r.size);
        if (!marketplace.has(r.shapeId)) marketplace.set(r.shapeId, { ...cell, size: r.size });
      }
    }
    for (const id of new Set(run.results.map((r) => r.shapeId))) runsPerShape.set(id, (runsPerShape.get(id) ?? 0) + 1);
  }
  return {
    synthSizes: [...synthSizes].sort((a, b) => a - b),
    marketSizes: [...marketSizes].sort((a, b) => a - b),
    cells,
    marketplace,
    runsPerShape,
    doneRuns: done.length,
  };
}

export interface CompareRow {
  view: ShapeView;
  size: number;
  a: number;
  b: number;
  deltaMs: number;
  pct: number;
}

/** Same shapes at the largest size both runs measured. */
export function compareRuns(a: RunModel, b: RunModel): { size: number | null; rows: CompareRow[] } {
  const common = a.sizes.filter((s) => b.sizes.includes(s));
  const size = common.length ? common[common.length - 1]! : null;
  if (size == null) return { size: null, rows: [] };
  const rows: CompareRow[] = [];
  for (const s of a.shapes) {
    const ra = s.results.find((r) => r.size === size);
    const rb = b.byId.get(s.id)?.results.find((r) => r.size === size);
    if (!ra || !rb || rb.p95Ms <= 0) continue;
    rows.push({ view: s, size, a: ra.p95Ms, b: rb.p95Ms, deltaMs: ra.p95Ms - rb.p95Ms, pct: ((ra.p95Ms - rb.p95Ms) / rb.p95Ms) * 100 });
  }
  return { size, rows };
}
