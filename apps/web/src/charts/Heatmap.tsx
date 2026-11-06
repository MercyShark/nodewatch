import { useMemo } from "react";
import * as echarts from "echarts/core";
import { HeatmapChart } from "echarts/charts";
import { GridComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/esm/core";
import { useMotionOk } from "@/lib/motion";

echarts.use([HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export interface HeatCell {
  x: string;
  y: string;
  value: number;
}

/** Sequential single-hue blue ramp, dark surface → light. Values are coloured on a log10 scale. */
const RAMP = ["#D6E4F6", "#A9C4E8", "#7A9DD0", "#4A6FAD", "#24427E", "#0D1A33"];

export function Heatmap({
  cells,
  xCats,
  yCats,
  xName,
  yName,
  unit,
  height,
}: {
  cells: HeatCell[];
  xCats: string[];
  yCats: string[];
  xName: string;
  yName: string;
  unit: string;
  height: number;
}) {
  const motionOk = useMotionOk();
  const option = useMemo(() => {
    const vals = cells.map((c) => c.value).filter((v) => v > 0);
    const lo = Math.log10(Math.max(0.1, vals.length ? Math.min(...vals) : 1));
    const hi = Math.max(lo + 1, Math.log10(vals.length ? Math.max(...vals) : 10));
    const fmt = (v: number) => `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${unit}`;
    return {
      backgroundColor: "transparent",
      animation: motionOk,
      textStyle: { fontFamily: "Ubuntu Mono, monospace", color: "#3B4C6B" },
      // Fixed left margin fits "shape #NN" labels (containLabel is legacy in ECharts 6).
      grid: { left: 76, right: 16, top: 36, bottom: 72 },
      tooltip: {
        trigger: "item",
        backgroundColor: "#0D1A33",
        borderColor: "#2A3D63",
        textStyle: { color: "#E3EDF9", fontSize: 12 },
        formatter: (p: { data: [number, number, number, number] }) => {
          const [xi, yi, , raw] = p.data;
          return `<div style="font-size:12px;color:#9FB6D6">${yCats[yi]} · ${Number(xCats[xi]).toLocaleString("en-US")} entities</div><b>${fmt(raw)}</b> <span style="color:#9FB6D6">p95</span>`;
        },
      },
      xAxis: {
        type: "category",
        data: xCats,
        name: xName,
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { color: "#3B4C6B", fontSize: 11 },
        axisLabel: { color: "#3B4C6B", formatter: (v: string) => Number(v).toLocaleString("en-US") },
        axisLine: { lineStyle: { color: "#9DB5D6" } },
        axisTick: { show: false },
        splitArea: { show: false },
      },
      yAxis: {
        type: "category",
        data: yCats,
        name: yName,
        nameTextStyle: { color: "#3B4C6B", fontSize: 11, align: "left" },
        axisLabel: { color: "#3B4C6B", fontSize: 11 },
        axisLine: { lineStyle: { color: "#9DB5D6" } },
        axisTick: { show: false },
        inverse: true,
      },
      visualMap: {
        type: "continuous",
        min: lo,
        max: hi,
        dimension: 2,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        itemWidth: 12,
        itemHeight: 160,
        calculable: false,
        text: [fmt(10 ** hi), fmt(10 ** lo)],
        textStyle: { color: "#3B4C6B", fontSize: 11 },
        inRange: { color: RAMP },
        formatter: (v: number) => fmt(10 ** v),
      },
      series: [
        {
          type: "heatmap",
          data: cells.map((c) => [xCats.indexOf(c.x), yCats.indexOf(c.y), Math.log10(Math.max(0.1, c.value)), c.value]),
          itemStyle: { borderColor: "#B4CDEE", borderWidth: 2, borderRadius: 3 },
          emphasis: { itemStyle: { borderColor: "#0D1A33", borderWidth: 1 } },
          progressive: 0,
        },
      ],
    };
  }, [cells, xCats, yCats, xName, yName, unit, motionOk]);

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge
      style={{ height, width: "100%" }}
      opts={{ renderer: "canvas" }}
    />
  );
}
