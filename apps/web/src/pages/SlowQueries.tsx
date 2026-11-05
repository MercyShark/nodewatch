import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Download, FileJson, GitCompare, Grid3x3, LayoutDashboard, ListTree, Microscope, TrendingUp } from "lucide-react";
import type { BenchRun } from "@nodewatch/shared";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/form";
import { useIsAdmin } from "@/lib/auth";
import { isForbidden } from "@/lib/api";
import { useBenchCatalog, useBenchRun, useBenchRuns } from "@/lib/queries";
import { fmtAgo, fmtNum } from "@/lib/format";
import { downloadText, toCsv } from "@/lib/csv";
import { AdminOnlyPanel, Stagger, StaggerItem } from "./admin-shared";
import { ACTIVE, buildRun } from "./slow-queries/model";
import { PrivacyBar, RunControls, RunProgress, Tabs, TARGETS, type TabDef } from "./slow-queries/parts";
import { SummaryTab } from "./slow-queries/SummaryTab";
import { CoverageTab } from "./slow-queries/CoverageTab";
import { ScalingTab } from "./slow-queries/ScalingTab";
import { PagingTab } from "./slow-queries/PagingTab";
import { ShapeTab } from "./slow-queries/ShapeTab";
import { CompareTab } from "./slow-queries/CompareTab";
import { MethodTab } from "./slow-queries/MethodTab";

type TabId = "summary" | "coverage" | "scaling" | "paging" | "shape" | "compare" | "method";
const TABS: TabDef<TabId>[] = [
  { id: "summary", label: "Summary", icon: <LayoutDashboard /> },
  { id: "coverage", label: "Shapes × datasets", icon: <Grid3x3 /> },
  { id: "scaling", label: "Scaling", icon: <TrendingUp /> },
  { id: "paging", label: "Paging", icon: <ListTree /> },
  { id: "shape", label: "Shape explorer", icon: <Microscope /> },
  { id: "compare", label: "Compare runs", icon: <GitCompare /> },
  { id: "method", label: "Method", icon: <BookOpen /> },
];
const SAFE_KEY = "nw.bench.demoSafe";

function readSafe(): boolean {
  try {
    return localStorage.getItem(SAFE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function SlowQueries() {
  const admin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "summary") as TabId;
  const shapeParam = params.get("shape");
  const runParam = params.get("run");
  const setParam = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v == null) n.delete(k);
          else n.set(k, v);
        }
        return n;
      },
      { replace: true },
    );

  // Viewers never see names or query text; admins choose.
  const [safePref, setSafePref] = useState(readSafe);
  const safe = !admin || safePref;
  const setSafe = (v: boolean) => {
    setSafePref(v);
    try {
      localStorage.setItem(SAFE_KEY, v ? "1" : "0");
    } catch {
      /* private mode: preference lasts for this page only */
    }
  };

  const runs = useBenchRuns(true);
  const catalog = useBenchCatalog(true);
  const list = runs.data ?? [];
  const runId = runParam && list.some((r) => r.id === runParam) ? runParam : (list.find((r) => r.status === "done")?.id ?? list[0]?.id ?? null);
  const run = useBenchRun(runId);
  const current: BenchRun | null = run.data ?? list.find((r) => r.id === runId) ?? null;
  const model = useMemo(() => (current ? buildRun(current, catalog.data, safe) : null), [current, catalog.data, safe]);

  useEffect(() => {
    if (current && !ACTIVE.includes(current.status)) void runs.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.status]);

  const anyActive = list.some((r) => ACTIVE.includes(r.status));
  const openShape = (id: string) => setParam({ tab: "shape", shape: id });
  const state = { isLoading: run.isLoading && !current, error: run.error, refetch: () => void run.refetch(), isFetching: run.isFetching };

  if (runs.error && isForbidden(runs.error)) {
    return (
      <>
        <PageHeader title="Slow queries" description="Which Arkiv query shapes get slow as data grows." />
        <AdminOnlyPanel what="Slow-query findings are private: they go only to Arkiv engineers through the encrypted Swarm vault." />
      </>
    );
  }

  const exportCsv = () => {
    if (!model) return;
    const data = model.shapes.flatMap((s) =>
      s.results.map((r) => ({
        shape: s.name,
        shapeId: s.id,
        family: s.family ?? "",
        size: r.size,
        p50Ms: r.p50Ms,
        p95Ms: r.p95Ms,
        p99Ms: r.p99Ms,
        minMs: r.stats?.minMs ?? "",
        maxMs: r.stats?.maxMs ?? "",
        meanMs: r.stats?.meanMs ?? "",
        stdMs: r.stats?.stdMs ?? "",
        rows: r.rows,
        bytes: r.bytes,
        errors: r.errors,
        k: s.k ?? "",
        slow: s.slow,
        query: safe ? "" : (r.shapeText ?? ""),
      })),
    );
    const cols = Object.keys(data[0] ?? {}).filter((c) => !(safe && (c === "query" || c === "family")));
    downloadText(`nodewatch-bench-${model.run.id.slice(0, 8)}${safe ? "-demo-safe" : ""}.csv`, toCsv(data, cols));
  };
  const exportJson = () => {
    if (!model) return;
    const report = {
      run: { id: model.run.id, target: model.run.target, sizes: model.sizes, startedAt: model.run.startedAt, finishedAt: model.run.finishedAt, meta: model.run.meta },
      thresholds: catalog.data?.thresholds,
      totals: { ...model.totals, worst: model.totals.worst?.name ?? null, maxK: model.totals.maxK?.name ?? null },
      shapes: model.shapes.map((s) => ({
        shape: s.name,
        id: s.id,
        family: s.family,
        k: s.k,
        r2: s.fit?.r2 ?? null,
        slow: s.slow,
        risk: s.risk,
        results: s.results.map((r) => ({ size: r.size, p50: r.p50Ms, p95: r.p95Ms, p99: r.p99Ms, rows: r.rows, bytes: r.bytes, errors: r.errors, stats: r.stats, query: safe ? undefined : r.shapeText })),
      })),
      privacy: safe ? "demo-safe: names, families and query text removed" : "PRIVATE: contains query text, do not publish",
    };
    downloadText(`nodewatch-bench-${model.run.id.slice(0, 8)}${safe ? "-demo-safe" : ""}.json`, JSON.stringify(report, null, 2), "application/json");
  };

  return (
    <>
      <PageHeader
        title="Slow queries"
        description="Which Arkiv query shapes get slow as the dataset grows: every shape, every dataset, every size, with the statistics behind each verdict."
        actions={
          model ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={exportCsv}>
                <Download className="size-4" aria-hidden /> CSV
              </Button>
              <Button size="sm" onClick={exportJson}>
                <FileJson className="size-4" aria-hidden /> JSON report
              </Button>
            </div>
          ) : null
        }
      />

      <Stagger page="slow-queries" className="flex flex-col gap-4">
        <StaggerItem>
          <PrivacyBar admin={admin} safe={safe} onSafe={setSafe} />
        </StaggerItem>

        <div className="grid gap-4 lg:grid-cols-2">
          {admin ? (
            <StaggerItem>
              <RunControls running={anyActive} onStarted={(id) => setParam({ run: id, tab: "summary" })} />
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
                  <EmptyState title="No runs yet">{admin ? "Start a run to measure query shapes against this node." : "An admin has not run a benchmark yet."}</EmptyState>
                ) : (
                  <>
                    <Field label="Run" htmlFor="bench-run">
                      <Select id="bench-run" value={runId ?? ""} onChange={(e) => setParam({ run: e.target.value })}>
                        {list.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.id.slice(0, 8)} · {TARGETS[r.target]?.label ?? r.target} · {r.status} · {r.sizes.map((s) => fmtNum(s)).join("/")} · {fmtAgo(r.startedAt)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {current ? <RunProgress run={current} /> : null}
                  </>
                )}
              </CardBody>
            </Card>
          </StaggerItem>
        </div>

        <StaggerItem>
          <Tabs tabs={TABS} value={tab} onChange={(t) => setParam({ tab: t })} label="Slow-query views" />
        </StaggerItem>

        <StaggerItem>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex flex-col gap-4">
            {tab === "coverage" ? (
              <CoverageTab catalog={catalog.data} runs={list} safe={safe} onOpen={openShape} />
            ) : tab === "method" ? (
              <MethodTab catalog={catalog.data} />
            ) : !current ? (
              <EmptyState title="No run selected">Start a run, or pick one above.</EmptyState>
            ) : !model ? (
              <EmptyState title="No results yet">Results appear as each dataset size completes.</EmptyState>
            ) : tab === "summary" ? (
              <SummaryTab m={model} catalog={catalog.data} safe={safe} onOpen={openShape} state={state} />
            ) : tab === "scaling" ? (
              <ScalingTab m={model} catalog={catalog.data} safe={safe} onOpen={openShape} state={state} />
            ) : tab === "paging" ? (
              <PagingTab m={model} safe={safe} onOpen={openShape} state={state} />
            ) : tab === "shape" ? (
              <ShapeTab m={model} catalog={catalog.data} runs={list} safe={safe} shapeId={shapeParam} onShape={(id) => setParam({ shape: id })} state={state} />
            ) : (
              <CompareTab m={model} runs={list} catalog={catalog.data} safe={safe} onOpen={openShape} state={state} />
            )}
          </div>
        </StaggerItem>
      </Stagger>
    </>
  );
}
