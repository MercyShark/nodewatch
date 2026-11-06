import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DiskForecast } from "@nodewatch/shared";
import { fmtDateTime, fmtFixed, fmtGB, fmtTimeTick, GB } from "@/lib/format";
import { DataTable } from "@/components/ui/table";
import { AXIS, GRID } from "./theme";
import { AxisCaption, ChartLegend, TooltipBox } from "./parts";

const DAY = 86400_000;
const ACTUAL = "#8FB4E3";
const PROJ = "#7EE0B5";

interface Model {
  rows: { t: number; actual?: number; projected?: number }[];
  now: number;
  end: number;
  capacity: number | null;
  fullAt: number | null;
  fullVisible: boolean;
  warnEnd: number;
  critEnd: number;
}

function build(f: DiskForecast): Model | null {
  const last = f.samples[f.samples.length - 1];
  if (!last) return null;
  const now = last.t;
  const capacity = f.freeBytes != null ? last.v + f.freeBytes : null;
  const projEnd = f.projection[f.projection.length - 1];
  const fullAt = f.daysToFull != null ? now + f.daysToFull * DAY : projEnd?.t ?? null;
  const critEnd = now + f.thresholds.critDays * DAY;
  const warnEnd = now + f.thresholds.warnDays * DAY;
  const minEnd = now + (f.thresholds.warnDays + 1) * DAY;
  const maxEnd = now + 30 * DAY;
  const end = Math.max(minEnd, Math.min(fullAt ?? maxEnd, maxEnd));
  const fullVisible = fullAt != null && fullAt <= end;

  const rows: Model["rows"] = f.samples.map((p) => ({ t: p.t, actual: p.v }));
  // Projection: clip at the visible window by linear interpolation.
  const proj = [...f.projection].sort((a, b) => a.t - b.t);
  if (proj.length >= 2) {
    const out: { t: number; v: number }[] = [];
    for (let i = 0; i < proj.length; i++) {
      const p = proj[i]!;
      if (p.t <= end) out.push(p);
      else {
        const prev = proj[i - 1];
        if (prev && prev.t < end) {
          const k = (end - prev.t) / (p.t - prev.t);
          out.push({ t: end, v: prev.v + k * (p.v - prev.v) });
        }
        break;
      }
    }
    for (const p of out) rows.push({ t: p.t, projected: p.v });
  }
  // Join actual and projection at "now" so the dashed line starts on the solid one.
  const lastRow = rows.find((r) => r.t === now && r.actual != null);
  if (lastRow && lastRow.projected == null) lastRow.projected = lastRow.actual;
  rows.sort((a, b) => a.t - b.t);
  return { rows, now, end, capacity, fullAt, fullVisible, warnEnd, critEnd };
}

export function ForecastChart({ forecast, height = 300 }: { forecast: DiskForecast; height?: number }) {
  const m = useMemo(() => build(forecast), [forecast]);
  if (!m) return null;
  const span = m.end - (m.rows[0]?.t ?? m.now);
  const maxGB = Math.max(...m.rows.map((r) => Math.max(r.actual ?? 0, r.projected ?? 0))) / GB;
  const gbTick = (v: number) => fmtFixed(v / GB, maxGB < 10 ? 1 : 0);
  return (
    <div className="flex h-full flex-col">
      <ChartLegend
        items={[
          { key: "a", label: "Chain data (measured)", color: ACTUAL },
          { key: "p", label: "Projection (24 h trend)", color: PROJ, dash: "6 4" },
          { key: "w", label: `Full within ${forecast.thresholds.warnDays} d: warning`, color: "rgba(245,158,11,0.45)", kind: "rect" },
          { key: "c", label: `Full within ${forecast.thresholds.critDays} d: critical`, color: "rgba(239,68,68,0.5)", kind: "rect" },
        ]}
      />
      <div style={{ height: height - 60 }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={m.rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <ReferenceArea x1={m.now} x2={m.critEnd} fill="#F87171" fillOpacity={0.12} ifOverflow="hidden" />
            <ReferenceArea x1={m.critEnd} x2={m.warnEnd} fill="#F5B74A" fillOpacity={0.09} ifOverflow="hidden" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[m.rows[0]?.t ?? m.now, m.end]}
              tickFormatter={(t: number) => fmtTimeTick(t, span)}
              stroke={AXIS}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              minTickGap={56}
              tickMargin={6}
            />
            <YAxis
              stroke={AXIS}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={gbTick}
              domain={["auto", "auto"]}
            />
            <ReferenceLine x={m.now} stroke="#9FB6D6" strokeDasharray="2 3" label={{ value: "now", position: "insideTopLeft", fill: AXIS, fontSize: 11 }} />
            {m.fullVisible && m.capacity != null ? (
              <>
                <ReferenceLine
                  y={m.capacity}
                  stroke="#F87171"
                  strokeDasharray="4 4"
                  label={{ value: "disk full", position: "insideTopLeft", fill: AXIS, fontSize: 11 }}
                />
                <ReferenceDot
                  x={m.fullAt!}
                  y={m.capacity}
                  r={7}
                  shape={(p: { cx?: number; cy?: number }) => {
                    const cx = p.cx ?? 0;
                    const cy = p.cy ?? 0;
                    return (
                      <path
                        d={`M${cx} ${cy - 7}L${cx + 7} ${cy}L${cx} ${cy + 7}L${cx - 7} ${cy}Z`}
                        fill="#F87171"
                        stroke="#0D1A33"
                        strokeWidth={2}
                      >
                        <title>Projected disk full</title>
                      </path>
                    );
                  }}
                />
              </>
            ) : null}
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "#9FB6D6", strokeWidth: 1 }}
              content={(p) => {
                const props = p as unknown as { active?: boolean; label?: number; payload?: { dataKey?: string; value?: number }[] };
                if (!props.active || !props.payload?.length) return null;
                return (
                  <TooltipBox
                    title={fmtDateTime(Number(props.label))}
                    rows={props.payload
                      .filter((x) => typeof x.value === "number")
                      .map((x) => ({
                        key: String(x.dataKey),
                        label: x.dataKey === "actual" ? "measured" : "projected",
                        value: fmtGB(x.value as number, 2),
                        color: x.dataKey === "actual" ? ACTUAL : PROJ,
                        dash: x.dataKey === "actual" ? undefined : "6 4",
                      }))}
                  />
                );
              }}
            />
            <Line dataKey="actual" stroke={ACTUAL} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="projected" stroke={PROJ} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <AxisCaption y="↑ chain data, GB" x="time (local) →" />
    </div>
  );
}

export function ForecastTable({ forecast }: { forecast: DiskForecast }) {
  const step = Math.max(1, Math.floor(forecast.samples.length / 48));
  const rows = [
    ...forecast.samples.filter((_, i) => i % step === 0).map((p) => ({ t: p.t, v: p.v, kind: "measured" })),
    ...forecast.projection.map((p) => ({ t: p.t, v: p.v, kind: "projected" })),
  ].reverse();
  return (
    <DataTable
      caption="Disk forecast samples and projection"
      rows={rows}
      rowKey={(r) => `${r.kind}-${r.t}`}
      dense
      maxHeight={300}
      columns={[
        { key: "t", header: "Time", cell: (r) => <span className="num text-xs">{fmtDateTime(r.t)}</span>, sort: (r) => r.t },
        { key: "kind", header: "Kind", cell: (r) => r.kind },
        { key: "v", header: "Chain data", align: "right", cell: (r) => fmtGB(r.v, 2), sort: (r) => r.v },
      ]}
    />
  );
}
