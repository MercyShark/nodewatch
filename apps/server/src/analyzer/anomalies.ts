// Anomaly markers: a point whose z-score against the preceding 1 h baseline exceeds 3.
import type { SeriesPoint } from "@nodewatch/shared";

export interface Anomaly {
  metric: string;
  labels: Record<string, string>;
  t: number;
  v: number;
  z: number;
}

export const Z_THRESHOLD = 3;
const BASELINE_MS = 3600_000;
const MIN_BASELINE = 20;

/** Rolling z-score: each point is compared with the points in the hour before it. */
export function zscoreAnomalies(points: SeriesPoint[], metric: string, labels: Record<string, string> = {}): Anomaly[] {
  const out: Anomaly[] = [];
  let lo = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    while (lo < i && points[lo]!.t < p.t - BASELINE_MS) {
      sum -= points[lo]!.v;
      sumSq -= points[lo]!.v ** 2;
      lo++;
    }
    const n = i - lo;
    if (n >= MIN_BASELINE) {
      const mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
      if (sd > 1e-9) {
        const z = (p.v - mean) / sd;
        if (Math.abs(z) > Z_THRESHOLD) out.push({ metric, labels, t: p.t, v: p.v, z: Math.round(z * 100) / 100 });
      }
    }
    sum += p.v;
    sumSq += p.v ** 2;
  }
  return out;
}
