import { CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, SERIES_COLORS } from "./theme";
import { AxisCaption, ChartLegend, TooltipBox } from "./parts";

export interface RiskPoint {
  key: string;
  label: string;
  /** p95 at the largest size, ms (x, log scale). */
  p95: number;
  /** Growth factor (y). */
  k: number;
  slow: boolean;
}

const OK = SERIES_COLORS[0];
const FLAG = "#F59E0B";

/**
 * Risk map: how slow a shape is now (x) against how fast it gets worse (y). The two thresholds split the plane;
 * anything right of 250 ms or above k = 1.2 is slow. Slow points are triangles, not only a colour.
 */
export function RiskScatter({
  points,
  slowMs,
  slowK,
  height,
  onSelect,
  format,
}: {
  points: RiskPoint[];
  slowMs: number;
  slowK: number;
  height: number;
  onSelect?: (key: string) => void;
  format: (v: number) => string;
}) {
  const maxX = Math.max(slowMs * 1.6, ...points.map((p) => p.p95 * 1.3));
  const minX = Math.max(0.1, Math.min(...points.map((p) => p.p95)) / 1.5);
  const maxY = Math.max(slowK + 0.4, ...points.map((p) => p.k + 0.15));
  const minY = Math.min(-0.2, ...points.map((p) => p.k - 0.1));
  // 1-3-10 ticks on the log axis, so labels never crowd.
  const ticks = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000, 3000, 10000].filter((t) => t >= minX && t <= maxX);
  const ok = points.filter((p) => !p.slow);
  const slow = points.filter((p) => p.slow);
  return (
    <div className="flex h-full flex-col">
      <ChartLegend
        items={[
          { key: "ok", label: "Within budget (circle)", color: OK, kind: "rect" },
          { key: "slow", label: "Slow (triangle)", color: FLAG, kind: "rect" },
          { key: "zone", label: "Slow zone", color: "rgba(239,68,68,0.35)", kind: "rect" },
        ]}
      />
      <div style={{ height: height - 76 }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} />
            <XAxis
              type="number"
              dataKey="p95"
              scale="log"
              domain={[minX, maxX]}
              allowDataOverflow
              stroke={AXIS}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              ticks={ticks}
              tickFormatter={(v: number) => (v >= 1 ? String(v) : v.toFixed(1))}
            />
            <YAxis type="number" dataKey="k" domain={[minY, maxY]} stroke={AXIS} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => v.toFixed(1)} />
            <ReferenceArea x1={slowMs} x2={maxX} y1={minY} y2={maxY} fill="#EF4444" fillOpacity={0.07} ifOverflow="hidden" />
            <ReferenceArea x1={minX} x2={slowMs} y1={slowK} y2={maxY} fill="#EF4444" fillOpacity={0.07} ifOverflow="hidden" />
            <ReferenceLine x={slowMs} stroke="#EF4444" strokeDasharray="4 4" label={{ value: `${slowMs} ms`, position: "insideTopLeft", fill: AXIS, fontSize: 11 }} />
            <ReferenceLine y={slowK} stroke="#EF4444" strokeDasharray="4 4" label={{ value: `k = ${slowK}`, position: "insideBottomLeft", fill: AXIS, fontSize: 11 }} />
            <ReferenceLine y={1} stroke={AXIS} strokeOpacity={0.5} label={{ value: "k = 1 (linear)", position: "insideBottomRight", fill: AXIS, fontSize: 10 }} />
            <Tooltip
              cursor={false}
              isAnimationActive={false}
              content={(p) => {
                const props = p as unknown as { active?: boolean; payload?: { payload: RiskPoint }[] };
                const it = props.payload?.[0]?.payload;
                if (!props.active || !it) return null;
                return (
                  <TooltipBox
                    title={`${it.label}${it.slow ? " · slow" : ""}`}
                    rows={[
                      { key: "p95", label: "p95 at largest size", value: `${format(it.p95)} ms`, color: it.slow ? FLAG : OK },
                      { key: "k", label: "growth factor k", value: it.k.toFixed(2), color: it.slow ? FLAG : OK },
                    ]}
                  />
                );
              }}
            />
            <Scatter
              data={ok}
              fill={OK}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
              cursor={onSelect ? "pointer" : undefined}
              onClick={(d: unknown) => onSelect?.((d as { payload?: RiskPoint }).payload?.key ?? (d as RiskPoint).key)}
            />
            <Scatter
              data={slow}
              fill={FLAG}
              shape="triangle"
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
              cursor={onSelect ? "pointer" : undefined}
              onClick={(d: unknown) => onSelect?.((d as { payload?: RiskPoint }).payload?.key ?? (d as RiskPoint).key)}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <AxisCaption y="↑ growth factor k" x="p95 at the largest size, ms (log) →" />
    </div>
  );
}
