import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtDateTime, fmtTimeTick } from "@/lib/format";
import { DataTable, type Column } from "@/components/ui/table";
import { AXIS, GRID, mergeSeries, seriesColor, seriesDash, type ChartSeries, type Row } from "./theme";
import { AxisCaption, ChartLegend, TooltipBox } from "./parts";

export interface RefLine {
  y: number;
  label: string;
  tone: "warn" | "crit" | "neutral";
}

const toneStroke = { warn: "#F5B74A", crit: "#F87171", neutral: "#9FB6D6" } as const;

export function TimeSeriesChart({
  series,
  kind = "line",
  yFormat,
  yTickFormat,
  yUnit,
  yDomain,
  refLines,
  height = 240,
  showLegend,
}: {
  series: ChartSeries[];
  kind?: "line" | "area" | "stacked";
  /** Full value format for tooltips (with unit). */
  yFormat: (v: number) => string;
  /** Compact tick format (defaults to yFormat). */
  yTickFormat?: (v: number) => string;
  /** Axis caption, e.g. "GB" or "% of 8 vCPU". */
  yUnit: string;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  refLines?: RefLine[];
  height?: number;
  showLegend?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const styled = series.map((s, i) => ({ ...s, color: s.color ?? seriesColor(i), dash: s.dash ?? seriesDash(i) }));
  const rows = useMemo(() => mergeSeries(series), [series]);
  const span = rows.length > 1 ? rows[rows.length - 1]!.t - rows[0]!.t : 3600_000;
  const legend = showLegend ?? styled.length > 1;
  const plotHeight = height - (legend ? 40 : 0) - 18;
  const toggle = (k: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else if (n.size < styled.length - 1) n.add(k);
      return n;
    });

  const common = {
    data: rows,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={GRID} />
      <XAxis
        dataKey="t"
        type="number"
        scale="time"
        domain={["dataMin", "dataMax"]}
        tickFormatter={(t: number) => fmtTimeTick(t, span)}
        stroke={AXIS}
        tickLine={false}
        axisLine={{ stroke: GRID }}
        minTickGap={48}
        tickMargin={6}
      />
      <YAxis
        stroke={AXIS}
        tickLine={false}
        axisLine={false}
        width={56}
        tickFormatter={(v: number) => (yTickFormat ?? yFormat)(v)}
        domain={yDomain ?? ["auto", "auto"]}
        allowDecimals
      />
      <Tooltip
        cursor={{ stroke: "#9FB6D6", strokeWidth: 1 }}
        isAnimationActive={false}
        content={(p) => {
          const props = p as unknown as { active?: boolean; label?: number; payload?: { dataKey?: string; value?: number }[] };
          if (!props.active || !props.payload?.length) return null;
          return (
            <TooltipBox
              title={fmtDateTime(Number(props.label))}
              rows={props.payload
                .filter((x) => typeof x.value === "number")
                .map((x) => {
                  const s = styled.find((q) => q.key === x.dataKey)!;
                  return { key: s.key, label: s.label, value: yFormat(x.value as number), color: s.color, dash: s.dash };
                })}
            />
          );
        }}
      />
      {refLines?.map((r) => (
        <ReferenceLine
          key={r.label}
          y={r.y}
          stroke={toneStroke[r.tone]}
          strokeDasharray="4 4"
          ifOverflow="extendDomain"
          label={{ value: r.label, position: "insideTopRight", fill: AXIS, fontSize: 11 }}
        />
      ))}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {legend ? (
        <ChartLegend
          items={styled.map((s) => ({ key: s.key, label: s.label, color: s.color, dash: s.dash, kind: kind === "line" ? "line" : "rect" }))}
          hidden={hidden}
          onToggle={toggle}
        />
      ) : null}
      <div style={{ height: plotHeight }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "line" ? (
            <LineChart {...common}>
              {axes}
              {styled.map((s) =>
                hidden.has(s.key) ? null : (
                  <Line
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    type="monotone"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dash || undefined}
                    dot={false}
                    activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                    isAnimationActive={false}
                    connectNulls
                  />
                ),
              )}
            </LineChart>
          ) : (
            <AreaChart {...common}>
              {axes}
              {styled.map((s) =>
                hidden.has(s.key) ? null : (
                  <Area
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    type="monotone"
                    stackId={kind === "stacked" ? "a" : undefined}
                    stroke={s.color}
                    strokeWidth={kind === "stacked" ? 1 : 2}
                    strokeDasharray={kind === "stacked" ? undefined : s.dash || undefined}
                    fill={s.color}
                    fillOpacity={kind === "stacked" ? 0.55 : 0.16}
                    dot={false}
                    activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                    isAnimationActive={false}
                    connectNulls
                  />
                ),
              )}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      <AxisCaption y={`↑ ${yUnit}`} x="time (local) →" />
    </div>
  );
}

/** Table view for the same series (newest first). */
export function SeriesTable({
  series,
  format,
  caption,
}: {
  series: ChartSeries[];
  format: (v: number) => string;
  caption: string;
}) {
  const rows = useMemo(() => mergeSeries(series, 200).reverse(), [series]);
  const columns: Column<Row>[] = [
    { key: "t", header: "Time", cell: (r) => <span className="num text-xs">{fmtDateTime(r.t)}</span>, sort: (r) => r.t },
    ...series.map((s) => ({
      key: s.key,
      header: s.label,
      align: "right" as const,
      cell: (r: Row) => (typeof r[s.key] === "number" ? format(r[s.key] as number) : "—"),
      sort: (r: Row) => (r[s.key] as number | null) ?? null,
    })),
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(r) => String(r.t)} caption={caption} dense maxHeight={300} />;
}
