import { useMemo } from "react";
import * as echarts from "echarts/core";
import { BoxplotChart, ScatterChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/esm/core";
import { useMotionOk } from "@/lib/motion";
import { AXIS, GRID, SERIES_COLORS } from "./theme";
import { ChartLegend } from "./parts";

echarts.use([BoxplotChart, ScatterChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer]);

export interface BoxGroup {
  key: string;
  label: string;
  samples: number[];
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Five-number summary (min, q1, median, q3, max) of each group's samples. */
export function fiveNumber(samples: number[]): [number, number, number, number, number] {
  const s = [...samples].sort((a, b) => a - b);
  return [s[0] ?? 0, quantile(s, 0.25), quantile(s, 0.5), quantile(s, 0.75), s[s.length - 1] ?? 0];
}

/**
 * Latency spread per group: a box (25–75 %) with the median line and whiskers to min/max, plus every timed run as a
 * dot. A tall box or scattered dots means jitter; a box far above the others means a slower step.
 */
export function BoxPlot({
  groups,
  height,
  unit,
  xName,
  threshold,
}: {
  groups: BoxGroup[];
  height: number;
  unit: string;
  xName: string;
  threshold?: number;
}) {
  const motionOk = useMotionOk();
  const option = useMemo(() => {
    const fmt = (v: number) => `${v >= 100 ? Math.round(v) : v.toFixed(2)} ${unit}`;
    const boxes = groups.map((g) => fiveNumber(g.samples));
    const maxV = Math.max(...groups.flatMap((g) => g.samples), 1);
    const dots = groups.flatMap((g, gi) =>
      g.samples.map((v, si) => {
        // Deterministic jitter so dots do not hide each other.
        const j = (((si * 2654435761) >>> 0) % 1000) / 1000 - 0.5;
        return [gi + j * 0.36, v];
      }),
    );
    return {
      backgroundColor: "transparent",
      animation: motionOk,
      textStyle: { fontFamily: "Ubuntu Mono, monospace", color: AXIS },
      grid: { left: 60, right: 16, top: 12, bottom: 44 },
      tooltip: {
        trigger: "item",
        backgroundColor: "#16264A",
        borderColor: "#2E4470",
        textStyle: { color: "#E3EDF9", fontSize: 12 },
        formatter: (p: { seriesType: string; dataIndex: number; value: number[] }) => {
          if (p.seriesType === "boxplot") {
            const [mn, q1, md, q3, mx] = boxes[p.dataIndex]!;
            const g = groups[p.dataIndex]!;
            return `<div style="font-size:12px;color:#9FB6D6">${g.label} · ${g.samples.length} runs</div>
              max <b>${fmt(mx)}</b><br/>75 % <b>${fmt(q3)}</b><br/>median <b>${fmt(md)}</b><br/>25 % <b>${fmt(q1)}</b><br/>min <b>${fmt(mn)}</b>`;
          }
          const gi = Math.round(p.value[0]!);
          return `<div style="font-size:12px;color:#9FB6D6">${groups[gi]?.label ?? ""}</div><b>${fmt(p.value[1]!)}</b> one run`;
        },
      },
      xAxis: {
        type: "category",
        data: groups.map((g) => g.label),
        name: xName,
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { color: AXIS, fontSize: 11 },
        axisLabel: { color: AXIS },
        axisLine: { lineStyle: { color: "#27395F" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        name: `${unit}`,
        nameTextStyle: { color: AXIS, fontSize: 11, align: "right" },
        axisLabel: { color: AXIS, formatter: (v: number) => (v >= 100 ? Math.round(v) : v.toFixed(1)) },
        splitLine: { lineStyle: { color: GRID } },
        max: threshold && maxV > threshold * 0.6 ? Math.max(maxV * 1.1, threshold * 1.1) : undefined,
      },
      series: [
        {
          type: "boxplot",
          data: boxes,
          boxWidth: [12, 36],
          itemStyle: { color: "rgba(59,130,246,0.18)", borderColor: SERIES_COLORS[0], borderWidth: 2 },
          emphasis: { itemStyle: { borderColor: "#E6EEFA" } },
          ...(threshold && maxV > threshold * 0.6
            ? {
                markLine: {
                  symbol: "none",
                  silent: true,
                  lineStyle: { color: "#F87171", type: "dashed" },
                  label: { formatter: `${threshold} ${unit}`, color: AXIS },
                  data: [{ yAxis: threshold }],
                },
              }
            : {}),
        },
        {
          type: "scatter",
          data: dots,
          symbolSize: 5,
          itemStyle: { color: SERIES_COLORS[1], opacity: 0.75, borderColor: "#0D1A33", borderWidth: 1 },
          z: 3,
        },
      ],
    };
  }, [groups, unit, xName, threshold, motionOk]);

  return (
    <div className="flex h-full flex-col">
      <ChartLegend
        items={[
          { key: "box", label: "Middle 50 % of runs (box), median (line), min–max (whiskers)", color: SERIES_COLORS[0], kind: "rect" },
          { key: "dot", label: "One timed run", color: SERIES_COLORS[1], kind: "rect" },
        ]}
      />
      <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: height - 40, width: "100%" }} opts={{ renderer: "canvas" }} />
    </div>
  );
}
