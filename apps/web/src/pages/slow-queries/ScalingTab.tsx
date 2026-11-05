import { useMemo, useState } from "react";
import type { BenchCatalog } from "@nodewatch/shared";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { DataTable, type Column } from "@/components/ui/table";
import { ChartCard, type QueryState } from "@/charts/ChartCard";
import { Heatmap } from "@/charts/Heatmap";
import { LogLogChart } from "@/charts/LogLogChart";
import { RankingBars } from "@/charts/RankingBars";
import { fmtBytes, fmtNum } from "@/lib/format";
import { ms, type RunModel, type ShapeView } from "./model";
import { ShapeButton, VerdictBadge } from "./parts";

interface Row {
  view: ShapeView;
  size: number;
  p50: number;
  p95: number;
  p99: number;
  min: number | null;
  max: number | null;
  std: number | null;
  rows: number;
  errors: number;
  bytes: number;
  text: string | null;
}

export function ScalingTab({
  m,
  catalog,
  safe,
  onOpen,
  state,
}: {
  m: RunModel;
  catalog: BenchCatalog | undefined;
  safe: boolean;
  onOpen: (id: string) => void;
  state: QueryState;
}) {
  const slowMs = catalog?.thresholds.slowP95Ms ?? 250;
  const [family, setFamily] = useState("all");
  const [rankBy, setRankBy] = useState<"p95" | "k">("p95");
  const shapes = family === "all" ? m.shapes : m.shapes.filter((s) => s.family === family);

  const rows: Row[] = useMemo(
    () =>
      shapes.flatMap((v) =>
        v.results.map((r) => ({
          view: v,
          size: r.size,
          p50: r.p50Ms,
          p95: r.p95Ms,
          p99: r.p99Ms,
          min: r.stats?.minMs ?? null,
          max: r.stats?.maxMs ?? null,
          std: r.stats?.stdMs ?? null,
          rows: r.rows,
          errors: r.errors,
          bytes: r.bytes,
          text: safe ? null : r.shapeText,
        })),
      ),
    [shapes, safe],
  );
  const ranked = [...shapes].filter((s) => s.largest).sort((a, b) => (rankBy === "p95" ? b.largest!.p95Ms - a.largest!.p95Ms : (b.k ?? -9) - (a.k ?? -9)));
  const top8 = ranked.slice(0, 8);
  const heatHeight = Math.max(260, shapes.length * 24 + 110);
  const rankHeight = Math.max(240, ranked.length * 22 + 80);
  const multi = m.sizes.length > 1;

  const columns: Column<Row>[] = [
    { key: "shape", header: "Shape", cell: (r) => <ShapeButton name={r.view.name} onOpen={() => onOpen(r.view.id)} slow={r.view.slow} />, sort: (r) => r.view.num },
    ...(!safe
      ? [
          {
            key: "text",
            header: "Query (private)",
            hideBelow: "lg" as const,
            cell: (r: Row) => (
              <code className="num block max-w-[26rem] truncate text-xs text-muted" title={r.text ?? undefined}>
                {r.text}
              </code>
            ),
          },
        ]
      : []),
    { key: "size", header: "Size", align: "right", cell: (r) => fmtNum(r.size), sort: (r) => r.size },
    { key: "p50", header: "p50", align: "right", hideBelow: "md", cell: (r) => ms(r.p50), sort: (r) => r.p50 },
    { key: "p95", header: "p95 ms", align: "right", cell: (r) => ms(r.p95), sort: (r) => r.p95 },
    { key: "p99", header: "p99", align: "right", hideBelow: "md", cell: (r) => ms(r.p99), sort: (r) => r.p99 },
    { key: "min", header: "min", align: "right", hideBelow: "lg", cell: (r) => (r.min == null ? "—" : ms(r.min)), sort: (r) => r.min },
    { key: "max", header: "max", align: "right", hideBelow: "lg", cell: (r) => (r.max == null ? "—" : ms(r.max)), sort: (r) => r.max },
    { key: "std", header: "σ", align: "right", hideBelow: "lg", cell: (r) => (r.std == null ? "—" : ms(r.std)), sort: (r) => r.std },
    { key: "rows", header: "Rows", align: "right", hideBelow: "sm", cell: (r) => fmtNum(r.rows), sort: (r) => r.rows },
    { key: "bytes", header: "Bytes", align: "right", hideBelow: "lg", cell: (r) => fmtBytes(r.bytes), sort: (r) => r.bytes },
    { key: "errors", header: "Err", align: "right", hideBelow: "md", cell: (r) => fmtNum(r.errors), sort: (r) => r.errors },
    { key: "k", header: "k", align: "right", hideBelow: "sm", cell: (r) => (r.view.k == null ? "—" : r.view.k.toFixed(2)), sort: (r) => r.view.k },
    { key: "slow", header: "Verdict", cell: (r) => <VerdictBadge slow={r.view.slow} />, sort: (r) => (r.view.slow ? 1 : 0) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        {!safe && m.families.length ? (
          <Field label="Family" htmlFor="scaling-family">
            <Select id="scaling-family" value={family} onChange={(e) => setFamily(e.target.value)}>
              <option value="all">All families ({m.shapes.length} shapes)</option>
              {m.families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} ({f.shapes.length})
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Curves and ranking by</span>
          <Segmented
            label="Rank shapes by"
            value={rankBy}
            onChange={setRankBy}
            options={[
              { value: "p95", label: "Slowest now (p95)" },
              { value: "k", label: "Fastest growing (k)" },
            ]}
          />
        </div>
      </div>

      <ChartCard
        title="p95 latency by shape and dataset size"
        description="Lighter = slower. A row that lightens to the right slows down as data grows."
        state={state}
        height={heatHeight}
        summary={ranked[0] ? `Slowest at ${fmtNum(m.largest)} entities: ${ranked[0].name}, p95 ${ms(ranked[0].largest!.p95Ms)} ms.` : undefined}
        chart={() => (
          <Heatmap
            cells={rows.map((r) => ({ x: String(r.size), y: r.view.name, value: r.p95 }))}
            xCats={m.sizes.map(String)}
            yCats={shapes.map((s) => s.name)}
            xName="Dataset size (entities)"
            yName="Shape"
            unit="ms"
            height={heatHeight}
          />
        )}
        table={() => (
          <DataTable
            rows={rows}
            columns={columns.filter((c) => ["shape", "size", "p95"].includes(c.key))}
            rowKey={(r) => `${r.view.id}-${r.size}`}
            caption="p95 by shape and size"
            initialSort={{ key: "p95", dir: "desc" }}
            dense
            maxHeight={heatHeight}
          />
        )}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={`Scaling curves (top 8 by ${rankBy === "p95" ? "p95" : "k"})`}
          description="Flat line = unaffected by data size; steeper = grows faster."
          state={state}
          isEmpty={!multi}
          emptyText="Scaling needs at least two dataset sizes."
          height={360}
          chart={() => (
            <LogLogChart
              series={top8.map((s) => ({ key: s.id, label: `${s.name} · k ${s.k?.toFixed(2) ?? "—"}`, points: s.results.map((r) => ({ x: r.size, y: r.p95Ms })) }))}
              xTicks={m.sizes}
              height={360}
              xUnit="dataset size, entities"
              yUnit="p95 ms"
              yFormat={ms}
            />
          )}
          table={() => (
            <DataTable
              rows={rows.filter((r) => top8.includes(r.view))}
              columns={columns.filter((c) => ["shape", "size", "p95", "k"].includes(c.key))}
              rowKey={(r) => `${r.view.id}-${r.size}`}
              caption="Scaling data for the top 8 shapes"
              dense
              maxHeight={360}
            />
          )}
        />
        <ChartCard
          title={rankBy === "p95" ? `p95 ranking at ${fmtNum(m.largest)} entities` : "Growth-factor ranking"}
          description={
            rankBy === "p95"
              ? `Dashed line: the ${slowMs} ms slow threshold. Slow shapes carry a ▲ marker and the word “slow”.`
              : "k for every shape. Above 1 grows faster than the data; above 1.2 is flagged slow."
          }
          state={state}
          height={rankHeight}
          isEmpty={rankBy === "k" && !multi}
          emptyText="Growth factors need at least two dataset sizes."
          chart={() => (
            <RankingBars
              items={ranked.map((s) => ({ key: s.id, label: s.name, value: rankBy === "p95" ? s.largest!.p95Ms : Math.max(0, s.k ?? 0), flagged: s.slow }))}
              threshold={rankBy === "p95" ? slowMs : (catalog?.thresholds.slowK ?? 1.2)}
              thresholdLabel={rankBy === "p95" ? `${slowMs} ms` : `k ${catalog?.thresholds.slowK ?? 1.2}`}
              unit={rankBy === "p95" ? "p95 ms" : "k"}
              format={rankBy === "p95" ? ms : (v) => v.toFixed(2)}
              height={rankHeight}
            />
          )}
          table={() => (
            <DataTable
              rows={rows.filter((r) => r.size === m.largest)}
              columns={columns.filter((c) => ["shape", "p95", "k", "slow"].includes(c.key))}
              rowKey={(r) => r.view.id}
              caption="Ranking at the largest size"
              initialSort={{ key: rankBy, dir: "desc" }}
              dense
              maxHeight={rankHeight}
            />
          )}
        />
      </div>

      <Card>
        <CardHeader
          title="All measurements"
          description={`${fmtNum(rows.length)} measurements. Click a column to sort.`}
        />
        <CardBody>
          <DataTable rows={rows} columns={columns} rowKey={(r) => `${r.view.id}-${r.size}`} caption="All benchmark results" initialSort={{ key: "p95", dir: "desc" }} dense maxHeight={520} />
        </CardBody>
      </Card>
    </div>
  );
}
