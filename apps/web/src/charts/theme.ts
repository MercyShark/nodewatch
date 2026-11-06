import type { SeriesPoint } from "@nodewatch/shared";

/** Categorical order is fixed (CLAUDE.md 6.1). Dash patterns are the secondary encoding. */
export const SERIES_COLORS = ["#8FB4E3", "#7EE0B5", "#C4B5FD", "#F5B74A", "#22D3EE", "#F472B6"] as const;
export const SERIES_DASH = ["", "6 4", "2 3", "10 3 2 3", "", "4 4"] as const;
export const GRID = "#1C2C4F";
export const AXIS = "#9FB6D6";
export const OTHER_COLOR = "#6B7FA3";

export const seriesColor = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length]!;
export const seriesDash = (i: number) => SERIES_DASH[i % SERIES_DASH.length]!;

export interface ChartSeries {
  key: string;
  label: string;
  points: SeriesPoint[];
  color?: string;
  dash?: string;
}

export type Row = { t: number } & Record<string, number | null>;

/** Merge series on timestamp; bucket-average to at most maxPoints rows. */
export function mergeSeries(series: ChartSeries[], maxPoints = 600): Row[] {
  const map = new Map<number, Row>();
  for (const s of series) {
    for (const p of s.points) {
      let r = map.get(p.t);
      if (!r) {
        r = { t: p.t } as Row;
        map.set(p.t, r);
      }
      r[s.key] = p.v;
    }
  }
  const rows = [...map.values()].sort((a, b) => a.t - b.t);
  if (rows.length <= maxPoints) return rows;
  const size = Math.ceil(rows.length / maxPoints);
  const out: Row[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const r = { t: chunk[chunk.length - 1]!.t } as Row;
    for (const s of series) {
      const vals = chunk.map((c) => c[s.key]).filter((v): v is number => typeof v === "number");
      r[s.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    out.push(r);
  }
  return out;
}

/** "Nice" tick count by width so axes never crowd on phones. */
export const tickCount = (width: number) => (width < 420 ? 3 : width < 800 ? 5 : 7);

/** Chart chrome on the dusk/navy theme (canvas charts cannot read CSS variables). */
export const CRIT = "#F87171";
export const WARN = "#F5B74A";
export const SURFACE = "#0D1A33";
export const INK = "#E6EEFA";
export const MONO = "Ubuntu Mono, monospace";
export const TOOLTIP = { bg: "#16264A", border: "#2E4470", fg: "#E3EDF9", muted: "#9FB6D6" } as const;
