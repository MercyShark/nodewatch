import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, SERIES_COLORS } from "./theme";
import { AxisCaption, ChartLegend, TooltipBox } from "./parts";

export interface DeltaItem {
  key: string;
  label: string;
  /** Percent change B → A (positive = slower in A). */
  pct: number;
  detail: string;
}

const FASTER = SERIES_COLORS[0];
const SLOWER = "#F5B74A";

/** Diverging bars of percent change between two runs. Direction is also spelled out in the label (▲ slower / ▼ faster). */
export function DeltaBars({ items, height }: { items: DeltaItem[]; height: number }) {
  const raw = Math.max(10, ...items.map((i) => Math.abs(i.pct)));
  const step = [5, 10, 25, 50, 100, 250, 500, 1000].find((st) => st * 2 >= raw) ?? Math.ceil(raw / 2);
  const lim = step * 2;
  const ticks = [-lim, -step, 0, step, lim];
  return (
    <div className="flex h-full flex-col">
      <ChartLegend
        items={[
          { key: "slower", label: "▲ slower in this run", color: SLOWER, kind: "rect" },
          { key: "faster", label: "▼ faster in this run", color: FASTER, kind: "rect" },
        ]}
      />
      <div style={{ height: height - 58 }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap={4}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis
              type="number"
              domain={[-lim, lim]}
              ticks={ticks}
              stroke={AXIS}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${Math.round(v)} %`}
            />
            <YAxis
              type="category"
              dataKey="key"
              width={150}
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={(props: { x?: number | string; y?: number | string; index?: number; payload?: { value: string } }) => {
                const it = items.find((i) => i.key === props.payload?.value) ?? (props.index != null ? items[props.index] : undefined);
                return (
                  <text x={Number(props.x ?? 0) - 4} y={Number(props.y ?? 0) + 4} textAnchor="end" fill={AXIS} fontSize={11} fontFamily="Ubuntu Mono, monospace">
                    {it ? `${it.pct > 0 ? "▲" : it.pct < 0 ? "▼" : "="} ${it.label}` : props.payload?.value}
                  </text>
                );
              }}
            />
            <ReferenceLine x={0} stroke={AXIS} />
            <Tooltip
              cursor={{ fill: "rgba(147,163,191,0.08)" }}
              isAnimationActive={false}
              content={(p) => {
                const props = p as unknown as { active?: boolean; payload?: { payload: DeltaItem }[] };
                const it = props.payload?.[0]?.payload;
                if (!props.active || !it) return null;
                return (
                  <TooltipBox
                    title={it.label}
                    rows={[{ key: "d", label: it.detail, value: `${it.pct > 0 ? "+" : ""}${it.pct.toFixed(1)} %`, color: it.pct > 0 ? SLOWER : FASTER }]}
                  />
                );
              }}
            />
            <Bar dataKey="pct" isAnimationActive={false} maxBarSize={16} radius={4}>
              {items.map((it) => (
                <Cell key={it.key} fill={it.pct > 0 ? SLOWER : FASTER} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <AxisCaption y="shape" x="p95 change vs the other run →" />
    </div>
  );
}
