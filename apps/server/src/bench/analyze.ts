// Scaling analysis: fit log(p95) ~ k·log(size). Slow if p95 > 250 ms at the largest size or k > 1.2.
import { fitPower, SLOW_K, SLOW_P95_MS, type BenchStats } from "@nodewatch/shared";

export { SLOW_K, SLOW_P95_MS };

export function percentiles(samples: number[]): { p50: number; p95: number; p99: number } {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { p50: r(at(50)), p95: r(at(95)), p99: r(at(99)) };
}

/** Least-squares slope of log(p95) against log(size). Needs ≥ 2 distinct sizes; otherwise 0. */
export function fitK(points: { size: number; p95: number }[]): number {
  const f = fitPower(points.map((p) => ({ x: p.size, y: p.p95 })));
  return f ? Math.round(f.k * 1000) / 1000 : 0;
}

/** min / max / mean / sample standard deviation, rounded to 0.01 ms; samples kept in run order. */
export function stats(samples: number[]): BenchStats | null {
  if (!samples.length) return null;
  const r = (x: number) => Math.round(x * 100) / 100;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.length > 1 ? samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (samples.length - 1) : 0;
  return { minMs: r(Math.min(...samples)), maxMs: r(Math.max(...samples)), meanMs: r(mean), stdMs: r(Math.sqrt(variance)), samples: samples.map(r) };
}

export function scaling(results: { shapeId: string; size: number; p95Ms: number }[]): { shapeId: string; k: number; slow: boolean }[] {
  const by = new Map<string, { size: number; p95: number }[]>();
  for (const r of results) {
    const l = by.get(r.shapeId) ?? [];
    l.push({ size: r.size, p95: r.p95Ms });
    by.set(r.shapeId, l);
  }
  return [...by.entries()].map(([shapeId, pts]) => {
    const k = fitK(pts);
    const largest = pts.reduce((a, b) => (b.size > a.size ? b : a), pts[0]!);
    return { shapeId, k, slow: largest.p95 > SLOW_P95_MS || k > SLOW_K };
  });
}
