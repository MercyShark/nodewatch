import { useEffect, useMemo, useState } from "react";
import { Download, EyeOff, Play, ShieldCheck, Timer } from "lucide-react";
import type { BenchResult, BenchRun } from "@nodewatch/shared";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge, type Tone } from "@/components/ui/status";
import { DataTable, type Column } from "@/components/ui/table";
import { ChartCard } from "@/charts/ChartCard";
import { Heatmap } from "@/charts/Heatmap";
import { LogLogChart } from "@/charts/LogLogChart";
import { RankingBars } from "@/charts/RankingBars";
import { useIsAdmin } from "@/lib/auth";
import { isForbidden } from "@/lib/api";
import { useBenchRun, useBenchRuns, useStartBench } from "@/lib/queries";
import { fmtAgo, fmtDateTime, fmtDuration, fmtNum } from "@/lib/format";
import { downloadText, toCsv } from "@/lib/csv";
import { pushToast } from "@/lib/toast";
import { AdminOnlyPanel, Stagger, StaggerItem } from "./admin-shared";

const SLOW_MS = 250;
const PRESETS = {
  quick: { label: "Quick", sizes: [500, 1000] },
  standard: { label: "Standard", sizes: [500, 1000, 2500, 5000] },
  large: { label: "Large (sandbox)", sizes: [5000, 10000, 25000, 50000] },
} as const;
type PresetKey = keyof typeof PRESETS;

const statusTone: Record<BenchRun["status"], Tone> = {
  queued: "info",
  seeding: "info",
  running: "info",
  paused: "warn",
  done: "ok",
  failed: "crit",
};
const ACTIVE: BenchRun["status"][] = ["queued", "seeding", "running", "paused"];

const ms = (v: number) => (v >= 100 ? fmtNum(v, 0) : fmtNum(v, 1));
const shapeNum = (id: string) => Number(id.match(/\d+/)?.[0] ?? 0);

interface Row extends BenchResult {
  k: number | null;
  slow: boolean;
}

function RunControls({ running, onStarted }: { running: boolean; onStarted: (id: string) => void }) {
  const [target, setTarget] = useState<BenchRun["target"]>("own-node");
  const [preset, setPreset] = useState<PresetKey>("standard");
  const [confirm, setConfirm] = useState(false);
  const start = useStartBench();
  const sizes = PRESETS[preset].sizes;
  const largeOnOwn = preset === "large" && target === "own-node";

  return (
    <Card>
      <CardHeader
        title="Run a benchmark"
        icon={<Timer />}
        description="Queries go only to this node's EL_RPC_URL or a temporary sandbox. Any other target is refused by the server."
      />
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span id="bench-target" className="text-sm font-medium text-fg">
            Target
          </span>
          <Segmented
            label="Benchmark target"
            value={target}
            onChange={setTarget}
            options={[
              { value: "own-node", label: "Own node" },
              { value: "sandbox", label: "Sandbox" },
            ]}
          />
          <p className="text-xs text-muted">
            {target === "own-node"
              ? "Writes nwbench.item entities (6 h expiry) through our node using tGLM; all reads hit only our node. 500–5,000 entities."
              : "Creates a labelled, resource-limited dev-chain container only for this run, then removes it. Free gas allows 10k–50k entities."}
          </p>
        </div>
        <Field label="Dataset sizes" htmlFor="bench-sizes" hint={`Entities per step: ${sizes.map((s) => s.toLocaleString("en-US")).join(", ")}`}>
          <Select id="bench-sizes" value={preset} onChange={(e) => setPreset(e.target.value as PresetKey)}>
            {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
              <option key={k} value={k}>
                {PRESETS[k].label}
              </option>
            ))}
          </Select>
        </Field>
        {largeOnOwn ? (
          <InlineError error="Large datasets need the sandbox: own-node runs are limited by tGLM to 5,000 entities." />
        ) : null}
        <InlineError error={start.error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => setConfirm(true)} disabled={running || largeOnOwn} loading={start.isPending}>
            <Play className="size-4" aria-hidden /> Start run
          </Button>
          {running ? <span className="text-sm text-muted">A run is in progress.</span> : null}
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        loading={start.isPending}
        title="Start a slow-query run?"
        confirmLabel="Start run"
        description={
          <>
            {target === "own-node" ? (
              <>
                This writes up to {fmtNum(Math.max(...sizes))} <code className="num">nwbench.item</code> entities to Rabdi through our node,
                paid in tGLM, with a 6 h expiry.
              </>
            ) : (
              <>This starts a temporary sandbox container (3 vCPU / 6 GiB) and removes it when the run ends.</>
            )}{" "}
            The runner checks node health first and pauses automatically if head lag grows or host CPU passes 85 %.
          </>
        }
        onConfirm={() =>
          start.mutate(
            { target, sizes: [...sizes] },
            {
              onSuccess: (run) => {
                setConfirm(false);
                onStarted(run.id);
                pushToast({ tone: "info", title: "Benchmark started", body: `${run.id} on ${run.target}` });
              },
              onError: () => setConfirm(false),
            },
          )
        }
      />
    </Card>
  );
}

function RunStatus({ run }: { run: BenchRun }) {
  const pct = Math.round(run.progress * 100);
  const active = ACTIVE.includes(run.status);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={statusTone[run.status]}>{run.status}</StatusBadge>
        <span className="text-sm text-muted">
          {run.target === "own-node" ? "Own node" : "Sandbox"} · sizes{" "}
          <span className="num">{run.sizes.map((s) => s.toLocaleString("en-US")).join(" / ")}</span>
        </span>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>Progress</span>
          <span className="num">{pct} %</span>
        </div>
        <div
          role="progressbar"
          aria-label={`Run ${run.id} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2 overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className="h-full origin-left rounded-full bg-primary transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${run.progress})` }}
          />
        </div>
      </div>
      {run.message ? (
        <p className="text-sm text-fg" aria-live={active ? "polite" : "off"}>
          {run.message}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Started</dt>
        <dd className="num text-right sm:text-left">{fmtDateTime(run.startedAt)}</dd>
        <dt className="text-muted">Duration</dt>
        <dd className="num text-right sm:text-left">
          {fmtDuration(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)}
          {active ? " so far" : ""}
        </dd>
      </dl>
    </div>
  );
}

export default function SlowQueries() {
  const admin = useIsAdmin();
  const runs = useBenchRuns(true);
  const [selected, setSelected] = useState<string | null>(null);
  const list = runs.data ?? [];
  const runId = selected ?? list[0]?.id ?? null;
  const run = useBenchRun(runId);
  const current = run.data ?? list.find((r) => r.id === runId) ?? null;

  useEffect(() => {
    // Refresh the run list when the selected run finishes.
    if (current?.status === "done") void runs.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.status]);

  const anyActive = list.some((r) => ACTIVE.includes(r.status)) || (current ? ACTIVE.includes(current.status) : false);

  const derived = useMemo(() => {
    if (!current || current.results.length === 0) return null;
    const scaling = new Map(current.scaling.map((s) => [s.shapeId, s]));
    const sizes = [...new Set(current.results.map((r) => r.size))].sort((a, b) => a - b);
    const largest = sizes[sizes.length - 1]!;
    const shapes = [...new Set(current.results.map((r) => r.shapeId))].sort((a, b) => shapeNum(a) - shapeNum(b));
    const rows: Row[] = current.results.map((r) => {
      const sc = scaling.get(r.shapeId);
      const atLargest = current.results.find((x) => x.shapeId === r.shapeId && x.size === largest);
      return { ...r, k: sc?.k ?? null, slow: sc?.slow ?? (atLargest?.p95Ms ?? 0) > SLOW_MS };
    });
    const atLargest = rows.filter((r) => r.size === largest).sort((a, b) => b.p95Ms - a.p95Ms);
    const top8 = atLargest.slice(0, 8).map((r) => r.shapeId);
    return { sizes, largest, shapes, rows, atLargest, top8 };
  }, [current]);

  const hasText = !!derived?.rows.some((r) => r.shapeText);

  const exportCsv = () => {
    if (!derived) return;
    const cols = ["shapeId", ...(admin && hasText ? ["shapeText"] : []), "size", "p50Ms", "p95Ms", "p99Ms", "rows", "errors", "k", "slow"];
    const data = derived.rows.map((r) => ({ ...r, shapeText: admin ? r.shapeText : null }));
    downloadText(`nodewatch-bench-${current!.id}.csv`, toCsv(data as unknown as Record<string, unknown>[], cols));
  };

  if (runs.error && isForbidden(runs.error)) {
    return (
      <>
        <PageHeader title="Slow queries" description="Which Arkiv query shapes get slow as data grows." />
        <AdminOnlyPanel what="Slow-query findings are private: they go only to Arkiv engineers through the encrypted Swarm vault." />
      </>
    );
  }

  const columns: Column<Row>[] = [
    {
      key: "shape",
      header: "Shape",
      cell: (r) => <span className="num text-sm whitespace-nowrap">{r.shapeId}</span>,
      sort: (r) => shapeNum(r.shapeId),
    },
    ...(admin && hasText
      ? [
          {
            key: "text",
            header: "Query (private)",
            hideBelow: "lg" as const,
            cell: (r: Row) => (
              <code className="num block max-w-[28rem] truncate text-xs text-muted" title={r.shapeText ?? undefined}>
                {r.shapeText}
              </code>
            ),
          },
        ]
      : []),
    { key: "size", header: "Size", align: "right", cell: (r) => fmtNum(r.size), sort: (r) => r.size },
    { key: "p50", header: "p50 ms", align: "right", hideBelow: "md", cell: (r) => ms(r.p50Ms), sort: (r) => r.p50Ms },
    { key: "p95", header: "p95 ms", align: "right", cell: (r) => ms(r.p95Ms), sort: (r) => r.p95Ms },
    { key: "p99", header: "p99 ms", align: "right", hideBelow: "md", cell: (r) => ms(r.p99Ms), sort: (r) => r.p99Ms },
    { key: "rows", header: "Rows", align: "right", hideBelow: "lg", cell: (r) => fmtNum(r.rows), sort: (r) => r.rows },
    { key: "errors", header: "Errors", align: "right", hideBelow: "lg", cell: (r) => fmtNum(r.errors), sort: (r) => r.errors },
    { key: "k", header: "k", align: "right", hideBelow: "sm", cell: (r) => (r.k == null ? "—" : r.k.toFixed(2)), sort: (r) => r.k },
    {
      key: "slow",
      header: "Verdict",
      cell: (r) => (r.slow ? <StatusBadge tone="warn">slow</StatusBadge> : <StatusBadge tone="ok">ok</StatusBadge>),
      sort: (r) => (r.slow ? 1 : 0),
    },
  ];

  const chartState = { isLoading: run.isLoading && !current, error: run.error, refetch: () => void run.refetch(), isFetching: run.isFetching };
  const heatHeight = derived ? Math.max(260, derived.shapes.length * 24 + 110) : 300;
  const rankHeight = derived ? Math.max(240, derived.atLargest.length * 22 + 80) : 300;

  return (
    <>
      <PageHeader
        title="Slow queries"
        description="Which Arkiv query shapes get slow as the dataset grows. Fit: log(latency) ~ k·log(size); slow if p95 > 250 ms at the largest size or k > 1.2."
        actions={
          derived ? (
            <Button size="sm" onClick={exportCsv}>
              <Download className="size-4" aria-hidden /> Export CSV
            </Button>
          ) : null
        }
      />

      <p className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">
        {admin ? (
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
        ) : (
          <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <span>
          Findings are private. Query text is visible to admins only and never appears in public views, the demo or the repo;
          everyone else sees <span className="num text-fg">shape #N</span>. Reports go to Arkiv engineers through the encrypted Swarm vault.
        </span>
      </p>

      <Stagger page="slow-queries" className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {admin ? (
            <StaggerItem>
              <RunControls running={anyActive} onStarted={setSelected} />
            </StaggerItem>
          ) : null}
          <StaggerItem className={admin ? undefined : "lg:col-span-2"}>
            <Card className="h-full">
              <CardHeader title="Run" description="Pick a run to inspect. Active runs refresh every 2 s." />
              <CardBody className="flex flex-col gap-4">
                {runs.isLoading ? (
                  <div role="status" aria-label="Loading runs" className="flex flex-col gap-2">
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ) : runs.error ? (
                  <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
                ) : list.length === 0 ? (
                  <EmptyState title="No runs yet">
                    {admin ? "Start a run to measure query shapes against this node." : "An admin has not run a benchmark yet."}
                  </EmptyState>
                ) : (
                  <>
                    <Field label="Run" htmlFor="bench-run">
                      <Select id="bench-run" value={runId ?? ""} onChange={(e) => setSelected(e.target.value)}>
                        {list.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.id} · {r.target} · {r.status} · {fmtAgo(r.startedAt)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {current ? <RunStatus run={current} /> : null}
                  </>
                )}
              </CardBody>
            </Card>
          </StaggerItem>
        </div>

        {list.length > 0 ? (
          <>
            <StaggerItem>
              <ChartCard
                title="p95 latency by shape and dataset size"
                description="Heatmap, ms on a log colour scale. Lighter is slower."
                state={chartState}
                isEmpty={!derived}
                emptyText="This run has no results yet. Results appear as each size completes."
                height={heatHeight}
                summary={
                  derived
                    ? `Slowest at ${fmtNum(derived.largest)} entities: ${derived.atLargest[0]?.shapeId} with p95 ${ms(derived.atLargest[0]?.p95Ms ?? 0)} ms.`
                    : undefined
                }
                chart={() => (
                  <Heatmap
                    cells={derived!.rows.map((r) => ({ x: String(r.size), y: r.shapeId, value: r.p95Ms }))}
                    xCats={derived!.sizes.map(String)}
                    yCats={derived!.shapes}
                    xName="Dataset size (entities)"
                    yName="Shape"
                    unit="ms"
                    height={heatHeight}
                  />
                )}
                table={() => (
                  <DataTable
                    rows={derived!.rows}
                    columns={columns.filter((c) => ["shape", "size", "p95"].includes(c.key))}
                    rowKey={(r) => `${r.shapeId}-${r.size}`}
                    caption="p95 latency by shape and size"
                    initialSort={{ key: "p95", dir: "desc" }}
                    dense
                    maxHeight={heatHeight}
                  />
                )}
              />
            </StaggerItem>

            <div className="grid gap-4 xl:grid-cols-2">
              <StaggerItem>
                <ChartCard
                  title="Scaling curves (top 8 by p95)"
                  description="p95 vs dataset size on log-log axes. A steeper slope (k) means super-linear growth."
                  state={chartState}
                  isEmpty={!derived || derived.sizes.length < 2}
                  emptyText="Scaling needs at least two dataset sizes."
                  height={340}
                  chart={() => (
                    <LogLogChart
                      series={derived!.top8.map((id) => ({
                        key: id,
                        label: id,
                        points: derived!.rows.filter((r) => r.shapeId === id).map((r) => ({ x: r.size, y: r.p95Ms })),
                      }))}
                      xTicks={derived!.sizes}
                      height={340}
                      xUnit="dataset size, entities"
                      yUnit="p95 ms"
                      yFormat={ms}
                    />
                  )}
                  table={() => (
                    <DataTable
                      rows={derived!.rows.filter((r) => derived!.top8.includes(r.shapeId))}
                      columns={columns.filter((c) => ["shape", "size", "p95", "k"].includes(c.key))}
                      rowKey={(r) => `${r.shapeId}-${r.size}`}
                      caption="Scaling data for the top 8 shapes"
                      dense
                      maxHeight={340}
                    />
                  )}
                />
              </StaggerItem>
              <StaggerItem>
                <ChartCard
                  title={`p95 ranking at ${derived ? fmtNum(derived.largest) : "the largest"} entities`}
                  description="Dashed line: 250 ms slow threshold. Slow shapes carry a ▲ marker and the word “slow”."
                  state={chartState}
                  isEmpty={!derived}
                  height={rankHeight}
                  chart={() => (
                    <RankingBars
                      items={derived!.atLargest.map((r) => ({ key: r.shapeId, label: r.shapeId, value: r.p95Ms, flagged: r.slow }))}
                      threshold={SLOW_MS}
                      thresholdLabel="250 ms"
                      unit="p95 ms"
                      format={ms}
                      height={rankHeight}
                    />
                  )}
                  table={() => (
                    <DataTable
                      rows={derived!.atLargest}
                      columns={columns.filter((c) => ["shape", "p95", "k", "slow"].includes(c.key))}
                      rowKey={(r) => r.shapeId}
                      caption="p95 ranking at the largest size"
                      initialSort={{ key: "p95", dir: "desc" }}
                      dense
                      maxHeight={rankHeight}
                    />
                  )}
                />
              </StaggerItem>
            </div>

            <StaggerItem>
              <Card>
                <CardHeader
                  title="All results"
                  description={`${derived ? fmtNum(derived.rows.length) : 0} shape × size measurements, 30 runs each (5 warm-up).`}
                  actions={
                    derived ? (
                      <Button size="sm" onClick={exportCsv}>
                        <Download className="size-4" aria-hidden /> CSV
                      </Button>
                    ) : null
                  }
                />
                <CardBody>
                  {derived ? (
                    <DataTable
                      rows={derived.rows}
                      columns={columns}
                      rowKey={(r) => `${r.shapeId}-${r.size}`}
                      caption="All benchmark results"
                      initialSort={{ key: "p95", dir: "desc" }}
                      dense
                      maxHeight={480}
                    />
                  ) : (
                    <EmptyState title="No results yet" />
                  )}
                </CardBody>
              </Card>
            </StaggerItem>
          </>
        ) : null}
      </Stagger>
    </>
  );
}
