import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, SERIES_COLORS } from "./theme";
import { AxisCaption, ChartLegend, TooltipBox } from "./parts";

export interface RankItem {
  key: string;
  label: string;
  value: number;
  flagged: boolean;
}

const BASE = SERIES_COLORS[0];
const FLAG = "#7A4100";

/** Horizontal ranking bars. Flagged items get a marker + "slow" text in the label, not colour alone. */
export function RankingBars({
  items,
  threshold,
  thresholdLabel,
  unit,
  format,
  height,
}: {
  items: RankItem[];
  threshold?: number;
  thresholdLabel?: string;
  unit: string;
  format: (v: number) => string;
  height: number;
}) {
  return (
    <div className="flex h-full flex-col">
      <ChartLegend
        items={[
          { key: "ok", label: "Within budget", color: BASE, kind: "rect" },
          { key: "slow", label: "Slow (▲ marker)", color: FLAG, kind: "rect" },
        ]}
      />
      <div style={{ height: height - 58 }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap={4}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" stroke={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={format} />
            <YAxis
              type="category"
              dataKey="key"
              width={136}
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={(props: { x?: number | string; y?: number | string; payload?: { value: string } }) => {
                const it = items.find((i) => i.key === props.payload?.value);
                const x = Number(props.x ?? 0);
                const y = Number(props.y ?? 0);
                return (
                  <g transform={`translate(${x},${y})`}>
                    {it?.flagged ? <path d="M-132,4 l5,-9 l5,9 z" fill={FLAG} aria-hidden /> : null}
                    <text x={-4} y={4} textAnchor="end" fill={it?.flagged ? "#0D1A33" : AXIS} fontSize={11} fontFamily="Ubuntu Mono, monospace">
                      {it?.label ?? props.payload?.value}
                      {it?.flagged ? " slow" : ""}
                    </text>
                  </g>
                );
              }}
            />
            <Tooltip
              cursor={{ fill: "rgba(147,163,191,0.08)" }}
              isAnimationActive={false}
              content={(p) => {
                const props = p as unknown as { active?: boolean; payload?: { payload: RankItem }[] };
                const it = props.payload?.[0]?.payload;
                if (!props.active || !it) return null;
                return (
                  <TooltipBox
                    title={`${it.label}${it.flagged ? " · slow" : ""}`}
                    rows={[{ key: "v", label: unit, value: format(it.value), color: it.flagged ? FLAG : BASE }]}
                  />
                );
              }}
            />
            {threshold != null ? (
              <ReferenceLine
                x={threshold}
                stroke="#A0201A"
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
                label={{ value: thresholdLabel ?? String(threshold), position: "insideTopRight", fill: AXIS, fontSize: 11 }}
              />
            ) : null}
            <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={18}>
              {items.map((it) => (
                <Cell key={it.key} fill={it.flagged ? FLAG : BASE} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <AxisCaption y="shape" x={`${unit} →`} />
    </div>
  );
}
