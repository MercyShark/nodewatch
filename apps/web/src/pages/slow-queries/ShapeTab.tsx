import type { BenchCatalog, BenchRun } from "@nodewatch/shared";
import { Activity, Gauge, Rows3, TrendingUp } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/form";
import { Badge, ToneIcon } from "@/components/ui/status";
import { DataTable } from "@/components/ui/table";
import { BoxPlot } from "@/charts/BoxPlot";
import { ChartCard, type QueryState } from "@/charts/ChartCard";
import { LogLogChart } from "@/charts/LogLogChart";
import { SERIES_COLORS } from "@/charts/theme";
import { fmtAgo, fmtBytes, fmtNum } from "@/lib/format";
import { crossesSlowAt, kWords, ms, projections, type RunModel } from "./model";
import { Stat, TARGETS, VerdictBadge } from "./parts";

export function ShapeTab({
  m,
  catalog,
  runs,
  safe,
  shapeId,
  onShape,
  state,
}: {
  m: RunModel;
  catalog: BenchCatalog | undefined;
  runs: BenchRun[];
  safe: boolean;
  shapeId: string | null;
  onShape: (id: string) => void;
  state: QueryState;
}) {
  const slowMs = catalog?.thresholds.slowP95Ms ?? 250;
  const fallback = [...m.shapes].sort((a, b) => b.risk - a.risk)[0];
  const s = (shapeId ? m.byId.get(shapeId) : null) ?? fallback;
  if (!s) return <EmptyState title="No shapes in this run" />;

  const proj = projections(s);
  const cross = crossesSlowAt(s);
  const kw = kWords(m.sizes.length > 1 ? s.k : null);
  const big = s.largest;
  const famLabel = catalog?.families.find((f) => f.id === s.family)?.label ?? s.family;
  const ds = catalog?.datasets.find((d) => d.id === (s.info?.dataset ?? s.results[0]?.dataset));
  const hasSamples = s.results.some((r) => r.stats?.samples.length);
  const text = safe ? null : (big?.shapeText ?? s.results[0]?.shapeText ?? null);

  const measured = s.results.map((r) => ({ x: r.size, y: r.p95Ms }));
  const fitXs = [...new Set([...m.sizes, ...proj.map((p) => p.size)])].sort((a, b) => a - b);
  const series = [
    { key: "p95", label: "measured p95", points: measured, color: SERIES_COLORS[0], dash: "" },
    { key: "p50", label: "measured p50", points: s.results.map((r) => ({ x: r.size, y: r.p50Ms })), color: SERIES_COLORS[1], dash: "2 3" },
    ...(s.fit && m.sizes.length > 1
      ? [
          {
            key: "fit",
            label: `fit: k ${s.fit.k.toFixed(2)}${s.fit.r2 != null ? `, r² ${s.fit.r2.toFixed(2)}` : ""} (dashed = projection)`,
            points: fitXs.map((x) => ({ x, y: s.fit!.a * x ** s.fit!.k })),
            color: SERIES_COLORS[3],
            dash: "6 4",
            noDots: true,
          },
        ]
      : []),
  ];

  // The same shape across every finished run (results are labelled by id, which is stable across runs).
  const history = runs
    .filter((r) => r.status === "done")
    .map((r) => ({ run: r, res: r.results.filter((x) => x.shapeId === s.id) }))
    .filter((h) => h.res.length)
    .sort((a, b) => b.run.startedAt - a.run.startedAt);
  const histSizes = [...new Set(history.flatMap((h) => h.res.map((x) => x.size)))].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Shape" htmlFor="shape-pick">
          <Select id="shape-pick" value={s.id} onChange={(e) => onShape(e.target.value)}>
            {m.shapes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.slow ? " (slow)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span className="num">{s.name}</span>
              <VerdictBadge slow={s.slow} />
            </span>
          }
          description={safe ? `Shape id ${s.id}` : (s.info?.label ?? s.id)}
          actions={
            <div className="flex flex-wrap gap-1">
              {!safe && famLabel ? <Badge>{famLabel}</Badge> : null}
              {ds ? <Badge>{ds.schema.split(",")[0]}</Badge> : null}
              {!safe && s.info ? <Badge>select {s.info.select}</Badge> : null}
              {!safe && s.info ? <Badge>limit {s.info.limit}</Badge> : null}
            </div>
          }
        />
        <CardBody className="flex flex-col gap-3 text-sm">
          {!safe && s.info ? (
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted">Asks for</dt>
              <dd className="text-fg">{s.info.summary}</dd>
              <dt className="text-muted">Growth</dt>
              <dd>
                <span className="inline-flex items-start gap-1.5 text-fg">
                  <ToneIcon tone={kw.tone === "crit" ? "warn" : kw.tone === "warn" ? "info" : kw.tone} className="mt-0.5 size-4 shrink-0" />
                  {kw.text}
                </span>
              </dd>
            </dl>
          ) : (
            <p className="text-muted">Demo-safe view: names, descriptions and query text are hidden.</p>
          )}
          {text ? (
            <div className="rounded-lg border border-border bg-bg p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs tracking-wide text-muted uppercase">Query at {fmtNum(big?.size ?? 0)} entities (private)</span>
                <CopyButton text={text} label="Copy query" />
              </div>
              <code className="num block text-xs break-all whitespace-pre-wrap text-fg">{text}</code>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`p95 @ ${fmtNum(m.largest)}`} icon={<Gauge />} value={big ? `${ms(big.p95Ms)} ms` : "—"} tone={big && big.p95Ms > slowMs ? "warn" : "ok"} toneText="slow" sub={big ? `${Math.round((big.p95Ms / slowMs) * 100)} % of ${slowMs} ms` : undefined} />
        <Stat label="Growth k" icon={<TrendingUp />} value={m.sizes.length > 1 && s.k != null ? s.k.toFixed(2) : "—"} sub={s.fit?.r2 != null ? `fit quality r² ${s.fit.r2.toFixed(2)}` : "fit needs ≥ 3 sizes for r²"} />
        <Stat label="Growth ×" icon={<Activity />} value={s.growth != null ? `${s.growth.toFixed(2)}×` : "—"} sub={`p95 from ${fmtNum(m.sizes[0] ?? 0)} to ${fmtNum(m.largest)} (${fmtNum(m.largest / (m.sizes[0] ?? 1))}× data)`} />
        <Stat label="Rows" icon={<Rows3 />} value={big ? fmtNum(big.rows) : "—"} tone={big && big.rows === 0 ? "warn" : "ok"} toneText="empty" sub={big ? `${fmtBytes(big.bytes)} · ${fmtNum(big.errors)} errors` : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Scaling and projection"
          description="Measured latency as the data grows; the dashed line continues the trend to larger sizes."
          state={state}
          isEmpty={m.sizes.length < 2}
          emptyText="Scaling needs at least two dataset sizes."
          height={360}
          chart={() => (
            <LogLogChart series={series} xTicks={fitXs} height={360} xUnit="dataset size, entities" yUnit="ms" yFormat={ms} refY={{ y: slowMs, label: `${slowMs} ms` }} />
          )}
          footer={
            proj.length ? (
              <div className="border-t border-border px-4 py-3 text-xs text-muted sm:px-5">
                If the trend holds: {proj.map((p) => `${fmtNum(p.size)} → ${ms(p.p95)} ms`).join(" · ")}
                {cross ? ` · reaches ${slowMs} ms near ${fmtNum(Math.round(cross / 1000) * 1000)} entities` : ` · stays under ${slowMs} ms`}. Run a larger preset to measure it.
              </div>
            ) : null
          }
        />
        <ChartCard
          title="Latency spread per size"
          description="All 25 timed runs at each size. Tall box = jittery."
          state={state}
          isEmpty={!hasSamples}
          emptyText="Per-run samples are recorded from this version on. Start a new run to see the spread."
          height={360}
          chart={() => (
            <BoxPlot
              groups={s.results.filter((r) => r.stats?.samples.length).map((r) => ({ key: String(r.size), label: fmtNum(r.size), samples: r.stats!.samples }))}
              height={360}
              unit="ms"
              xName="dataset size, entities"
              threshold={slowMs}
            />
          )}
        />
      </div>

      <Card>
        <CardHeader title="Per size" description="Percentiles from the timed runs; min, max, mean and σ from the raw samples." />
        <CardBody>
          <DataTable
            rows={s.results}
            rowKey={(r) => String(r.size)}
            caption="Per-size statistics"
            dense
            columns={[
              { key: "size", header: "Size", cell: (r) => <span className="num">{fmtNum(r.size)}</span>, sort: (r) => r.size },
              { key: "p50", header: "p50", align: "right", cell: (r) => ms(r.p50Ms), sort: (r) => r.p50Ms },
              { key: "p95", header: "p95", align: "right", cell: (r) => ms(r.p95Ms), sort: (r) => r.p95Ms },
              { key: "p99", header: "p99", align: "right", cell: (r) => ms(r.p99Ms), sort: (r) => r.p99Ms },
              { key: "min", header: "min", align: "right", hideBelow: "sm", cell: (r) => (r.stats ? ms(r.stats.minMs) : "—") },
              { key: "mean", header: "mean", align: "right", hideBelow: "md", cell: (r) => (r.stats ? ms(r.stats.meanMs) : "—") },
              { key: "max", header: "max", align: "right", hideBelow: "sm", cell: (r) => (r.stats ? ms(r.stats.maxMs) : "—") },
              { key: "std", header: "σ", align: "right", hideBelow: "md", cell: (r) => (r.stats ? ms(r.stats.stdMs) : "—") },
              { key: "n", header: "runs", align: "right", hideBelow: "lg", cell: (r) => (r.stats ? fmtNum(r.stats.samples.length) : "—") },
              { key: "rows", header: "rows", align: "right", cell: (r) => fmtNum(r.rows) },
              { key: "bytes", header: "bytes", align: "right", hideBelow: "md", cell: (r) => fmtBytes(r.bytes) },
              { key: "err", header: "err", align: "right", hideBelow: "lg", cell: (r) => fmtNum(r.errors) },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="History across runs" description="This shape's p95 (ms) in every finished run, newest first. Shape ids are stable, so runs compare directly." />
        <CardBody>
          {history.length ? (
            <DataTable
              rows={history}
              rowKey={(h) => h.run.id}
              caption="Shape history across runs"
              dense
              columns={[
                { key: "run", header: "Run", cell: (h) => <span className="num text-sm">{h.run.id.slice(0, 8)}</span> },
                { key: "when", header: "When", cell: (h) => <span className="text-sm text-muted">{fmtAgo(h.run.startedAt)}</span> },
                { key: "target", header: "Target", hideBelow: "sm", cell: (h) => TARGETS[h.run.target]?.label ?? h.run.target },
                ...histSizes.map((z) => ({
                  key: `s${z}`,
                  header: fmtNum(z),
                  align: "right" as const,
                  cell: (h: (typeof history)[number]) => {
                    const r = h.res.find((x) => x.size === z);
                    return r ? ms(r.p95Ms) : "—";
                  },
                })),
              ]}
            />
          ) : (
            <EmptyState title="Only this run so far" />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
