// Scaling analysis: fit log(p95) ~ k·log(size). Slow if p95 > 250 ms at the largest size or k > 1.2.

export const SLOW_P95_MS = 250;
export const SLOW_K = 1.2;

export function percentiles(samples: number[]): { p50: number; p95: number; p99: number } {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { p50: r(at(50)), p95: r(at(95)), p99: r(at(99)) };
}

/** Least-squares slope of log(p95) against log(size). Needs ≥ 2 distinct sizes; otherwise 0. */
export function fitK(points: { size: number; p95: number }[]): number {
  const pts = points.filter((p) => p.size > 0 && p.p95 > 0).map((p) => ({ x: Math.log(p.size), y: Math.log(p.p95) }));
  const n = pts.length;
  if (n < 2) return 0;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0,
    sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  return sxx === 0 ? 0 : Math.round((sxy / sxx) * 1000) / 1000;
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
