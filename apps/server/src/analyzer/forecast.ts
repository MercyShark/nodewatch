// Disk forecast: linear regression of chain-data bytes over 6 h (alerting) and 24 h (display).
// A step of more than 5 GB between samples (snapshot restore, wipe) resets the window.
import type { DiskForecast, SeriesPoint } from "@nodewatch/shared";
import type { Ctx } from "../context.js";

export const STEP_RESET_BYTES = 5e9;
export const WARN_DAYS = 7;
export const CRIT_DAYS = 2;
export const CRIT_FREE_BYTES = 20e9;
const DAY = 86_400_000;
const EPS_PER_DAY = 1; // 1 byte/day: avoids division by zero, never a realistic rate

export interface DiskRow {
  ts: number;
  used: number; // chain data bytes (or host used bytes if volumes are unreadable)
  free: number | null;
  total: number | null;
}

export function linreg(points: { t: number; v: number }[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const t0 = points[0]!.t;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (const p of points) {
    const x = p.t - t0;
    sx += x;
    sy += p.v;
    sxx += x * x;
    sxy += x * p.v;
  }
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n - slope * t0;
  return { slope, intercept };
}

/** Samples after the last >5 GB step inside the window. */
export function windowAfterReset(rows: DiskRow[], since: number): DiskRow[] {
  const w = rows.filter((r) => r.ts >= since);
  let start = 0;
  for (let i = 1; i < w.length; i++) {
    if (Math.abs(w[i]!.used - w[i - 1]!.used) > STEP_RESET_BYTES) start = i;
  }
  return w.slice(start);
}

/** Bytes/day growth over a window, or null if there is not enough data (≥ 3 samples spanning ≥ 30 min). */
export function ratePerDay(rows: DiskRow[], windowMs: number, now: number): number | null {
  const w = windowAfterReset(rows, now - windowMs);
  if (w.length < 3 || w[w.length - 1]!.ts - w[0]!.ts < 30 * 60_000) return null;
  const fit = linreg(w.map((r) => ({ t: r.ts, v: r.used })));
  return fit ? fit.slope * DAY : null;
}

export function computeForecast(rows: DiskRow[], now = Date.now()): Omit<DiskForecast, "volumes"> {
  const last = rows[rows.length - 1] ?? null;
  const rate6 = ratePerDay(rows, 6 * 3600_000, now);
  const rate24 = ratePerDay(rows, 24 * 3600_000, now);
  const rate = rate6 ?? rate24;
  const free = last?.free ?? null;
  let daysToFull: number | null = null;
  const projection: SeriesPoint[] = [];
  if (free !== null && rate !== null && last) {
    daysToFull = Math.min(3650, free / Math.max(rate, EPS_PER_DAY));
    if (rate > 0) {
      const horizon = Math.min(daysToFull, 365) * DAY;
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const dt = (horizon * i) / steps;
        projection.push({ t: Math.round(last.ts + dt), v: Math.round(last.used + (rate * dt) / DAY) });
      }
    }
  }
  return {
    samples: rows.map((r) => ({ t: r.ts, v: r.used })),
    projection,
    freeBytes: free,
    totalBytes: last?.total ?? null,
    ratePerDay6h: rate6,
    ratePerDay24h: rate24,
    daysToFull: daysToFull === null ? null : Math.round(daysToFull * 100) / 100,
    thresholds: { warnDays: WARN_DAYS, critDays: CRIT_DAYS },
  };
}

export function loadDiskRows(ctx: Ctx, sinceMs: number, now = Date.now()): DiskRow[] {
  const rows = ctx.db
    .prepare("SELECT ts, used_bytes, free_bytes, total_bytes FROM disk_samples WHERE ts >= ? ORDER BY ts")
    .all(now - sinceMs) as { ts: number; used_bytes: number | null; free_bytes: number | null; total_bytes: number | null }[];
  return rows
    .filter((r) => r.used_bytes !== null)
    .map((r) => ({ ts: r.ts, used: r.used_bytes!, free: r.free_bytes, total: r.total_bytes }));
}

/** Every 5 minutes: record a disk sample. */
export function recordDiskSample(ctx: Ctx, now = Date.now()): void {
  const v = ctx.state.volumes;
  const h = ctx.state.host;
  const chain = v && (v.el !== null || v.cl !== null) ? (v.el ?? 0) + (v.cl ?? 0) : null;
  const used = chain ?? h?.diskUsed ?? null;
  if (used === null) return;
  ctx.db
    .prepare("INSERT OR REPLACE INTO disk_samples(ts, used_bytes, free_bytes, total_bytes, el_bytes, cl_bytes) VALUES (?, ?, ?, ?, ?, ?)")
    .run(now, used, h?.diskFree ?? null, h?.diskTotal ?? null, v?.el ?? null, v?.cl ?? null);
  ctx.db.prepare("DELETE FROM disk_samples WHERE ts < ?").run(now - 30 * DAY);
}

export function diskForecast(ctx: Ctx, now = Date.now()): DiskForecast {
  const rows = loadDiskRows(ctx, 7 * DAY, now);
  const f = computeForecast(rows, now);
  // Prefer live free/total over the 5-minute-old sample.
  const h = ctx.state.host;
  let daysToFull = f.daysToFull;
  const rate = f.ratePerDay6h ?? f.ratePerDay24h;
  if (h?.diskFree != null && rate !== null) {
    daysToFull = Math.round(Math.min(3650, h.diskFree / Math.max(rate, EPS_PER_DAY)) * 100) / 100;
  }
  return {
    ...f,
    daysToFull,
    freeBytes: h?.diskFree ?? f.freeBytes,
    totalBytes: h?.diskTotal ?? f.totalBytes,
    volumes: { el: ctx.state.volumes?.el ?? null, cl: ctx.state.volumes?.cl ?? null },
  };
}
