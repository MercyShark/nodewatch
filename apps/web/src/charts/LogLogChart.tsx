import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, OTHER_COLOR, SERIES_COLORS, SERIES_DASH } from "./theme";
import { AxisCaption, ChartLegend, TooltipBox } from "./parts";

export interface LogSeries {
  key: string;
  label: string;
  points: { x: number; y: number }[];
}

/**
 * Log-log scaling curves. Six palette hues in fixed order; series 7 and 8 use neutral grey with distinct dashes
 * (composite encoding) instead of generating new hues.
 */
const styleFor = (i: number) =>
  i < SERIES_COLORS.length
    ? { color: SERIES_COLORS[i]!, dash: SERIES_DASH[i]! }
    : { color: OTHER_COLOR, dash: i % 2 === 0 ? "6 4" : "2 3" };

export function LogLogChart({
  series,
  xTicks,
  height,
  xUnit,
  yUnit,
  yFormat,
}: {
  series: LogSeries[];
  xTicks: number[];
  height: number;
  xUnit: string;
  yUnit: string;
  yFormat: (v: number) => string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const styled = series.map((s, i) => ({ ...s, ...styleFor(i) }));
  const rows = useMemo(() => {
    const m = new Map<number, Record<string, number>>();
    for (const s of series)
      for (const p of s.points) {
        const r = m.get(p.x) ?? { x: p.x };
        r[s.key] = p.y;
        m.set(p.x, r);
      }
    return [...m.values()].sort((a, b) => a.x! - b.x!);
  }, [series]);
  const toggle = (k: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else if (n.size < styled.length - 1) n.add(k);
      return n;
    });

  return (
    <div className="flex h-full flex-col">
      <ChartLegend
        items={styled.map((s) => ({ key: s.key, label: s.label, color: s.color, dash: s.dash }))}
        hidden={hidden}
        onToggle={toggle}
      />
      <div style={{ height: height - 76 }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} />
            <XAxis
              dataKey="x"
              type="number"
              scale="log"
              domain={["dataMin", "dataMax"]}
              ticks={xTicks}
              tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : String(v))}
              stroke={AXIS}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              allowDataOverflow
            />
            <YAxis
              type="number"
              scale="log"
              domain={["auto", "auto"]}
              stroke={AXIS}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v: number) => yFormat(v)}
              allowDataOverflow
            />
            <Tooltip
              cursor={{ stroke: "#93A3BF", strokeWidth: 1 }}
              isAnimationActive={false}
              content={(p) => {
                const props = p as unknown as { active?: boolean; label?: number; payload?: { dataKey?: string; value?: number }[] };
                if (!props.active || !props.payload?.length) return null;
                return (
                  <TooltipBox
                    title={`${Number(props.label).toLocaleString("en-US")} entities`}
                    rows={props.payload
                      .filter((x) => typeof x.value === "number")
                      .sort((a, b) => (b.value as number) - (a.value as number))
                      .map((x) => {
                        const s = styled.find((q) => q.key === x.dataKey)!;
                        return { key: s.key, label: s.label, value: `${yFormat(x.value as number)} ms`, color: s.color, dash: s.dash };
                      })}
                  />
                );
              }}
            />
            {styled.map((s) =>
              hidden.has(s.key) ? null : (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  type="linear"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dash || undefined}
                  dot={{ r: 3, strokeWidth: 0, fill: s.color }}
                  activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ),
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <AxisCaption y={`↑ ${yUnit} (log)`} x={`${xUnit} (log) →`} />
    </div>
  );
}
