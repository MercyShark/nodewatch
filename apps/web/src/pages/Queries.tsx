import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { Activity, AlertTriangle, ArrowRightLeft, CheckCircle2, Clock, Gauge, Pause, Play, Radio, TriangleAlert, XCircle } from "lucide-react";
import type { LiveQueriesResponse, QueryShapeRow, RecentRequest, SlowRequest } from "@nodewatch/shared";
import { ChartToolbar, PageHeader } from "@/components/layout/PageHeader";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, type Column } from "@/components/ui/table";
import { StaggerItem, useFirstLoad } from "@/components/ui/stagger-item";
import { ChartCard, type QueryState } from "@/charts/ChartCard";
import { SeriesTable, TimeSeriesChart } from "@/charts/TimeSeriesChart";
import { OTHER_COLOR, seriesColor, type ChartSeries } from "@/charts/theme";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/api";
import { fmtAgo, fmtDateTime, fmtFixed, fmtNum, fmtPct, DASH } from "@/lib/format";
import { useLiveQueries, useSetInline } from "@/lib/queries";
import { useStore } from "@/lib/store";
import { rpcFeedStore } from "@/lib/stream";
import { pushToast } from "@/lib/toast";
import { useRange } from "@/lib/useRange";

const fmtMs = (v: number | null | undefined) => (v == null ? DASH : `${fmtFixed(v, v < 10 ? 1 : 0)} ms`);
const fmtClock = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour12: false });
const groupLabel: Record<string, string> = { arkiv_query: "arkiv_query", "eth_*": "eth_*", arkiv_other: "other arkiv_*", other: "other" };

/** Inline / passive switch. The only control on the page that changes the node. */
function ModeCard({ data, admin }: { data: LiveQueriesResponse; admin: boolean }) {
  const set = useSetInline();
  const [confirm, setConfirm] = useState<"on" | "off" | null>(null);
  const inline = data.mode === "inline";
  const target = data.target ? `${data.target.ip}:${data.target.port}` : "not configured";
  const run = (enabled: boolean) => {
    setConfirm(null);
    set.mutate(enabled, {
      onSuccess: (r) => pushToast({ tone: "ok", title: enabled ? "Inline mode is on" : "Back to passive", body: r.message }),
      onError: (e) => pushToast({ tone: "crit", title: "Switch failed", body: errorMessage(e) }),
    });
  };
  return (
    <Card className={cn(inline ? "border-ok/40" : data.drift ? "border-warn/50" : undefined)}>
      <CardHeader
        icon={inline ? <Radio /> : <ArrowRightLeft />}
        title={inline ? "Inline: watching the pool's traffic" : data.drift ? "Inline was on, but the tunnel points elsewhere" : "Passive: local requests only"}
        description={
          inline
            ? "The tunnel sends the load balancer's requests through Nodewatch, which times each one and forwards it to the node unchanged."
            : data.drift
              ? "frpc.toml was regenerated (setup.sh or a new agreement). Nodewatch re-applies inline within a minute; switch it off if that is not wanted."
              : "The load balancer talks to the execution container directly. Only probes and benchmarks reach the proxy, so these numbers are not pool traffic."
        }
        actions={
          <>
            <StatusBadge tone={inline ? "ok" : data.drift ? "warn" : "info"}>{inline ? "Inline" : data.drift ? "Drift" : "Passive"}</StatusBadge>
            {admin ? (
              inline ? (
                <Button size="sm" onClick={() => setConfirm("off")} loading={set.isPending || data.switching}>
                  Back to passive
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setConfirm("on")} loading={set.isPending || data.switching} disabled={!data.target}>
                  Switch to inline
                </Button>
              )
            ) : null}
          </>
        }
      />
      <CardBody>
        <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Tunnel sends traffic to</dt>
            <dd className="num text-fg">{target}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Nodewatch proxy</dt>
            <dd className="num text-fg">
              {data.proxy.ip ?? "gateway"}:{data.proxy.port}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Last request seen</dt>
            <dd className="num text-fg">{data.live.lastRequestAt ? fmtAgo(data.live.lastRequestAt) : "none yet"}</dd>
          </div>
        </dl>
        {!data.target && admin ? <p className="mt-3 text-sm text-muted">Join the pool first: the switch needs the tunnel's frpc.toml.</p> : null}
      </CardBody>
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "on" ? "Switch to inline?" : "Back to passive?"}
        description={confirm === "on" ? "Two lines of frpc.toml change and the tunnel container restarts." : "frpc.toml points back at the execution container and the tunnel restarts."}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === "on" ? "primary" : "secondary"} onClick={() => run(confirm === "on")}>
              {confirm === "on" ? "Switch to inline" : "Back to passive"}
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-2 text-sm text-muted">
          <li className="flex gap-2">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
            The tunnel reconnects in about 10 seconds. Requests in flight during the restart fail.
          </li>
          {confirm === "on" ? (
            <>
              <li className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                While inline, a Nodewatch restart (update, deploy) pauses paid serving for the restart time. The tunnel reconnects by itself.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                Requests are forwarded byte for byte. Only method, timing and the query shape are recorded; query values are never stored.
              </li>
            </>
          ) : null}
        </ul>
      </Dialog>
    </Card>
  );
}

function Tile({ label, value, sub, icon, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon: React.ReactNode; tone?: "warn" | "crit" }) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-border bg-surface p-4", tone === "warn" && "border-warn/50", tone === "crit" && "border-crit/50")}>
      <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted uppercase [&>svg]:size-3.5">
        {icon}
        {label}
      </dt>
      <dd className="num mt-1 text-2xl font-semibold text-fg">{value}</dd>
      {sub ? <dd className="mt-0.5 truncate text-xs text-muted">{sub}</dd> : null}
    </div>
  );
}

function LiveFeed({ initial, shapes, slowMs }: { initial: RecentRequest[]; shapes: Map<string, string>; slowMs: number }) {
  const feed = useStore(rpcFeedStore);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<RecentRequest[]>([]);
  const rows = useMemo(() => {
    if (paused) return frozen;
    const seen = new Set<string>();
    const merged: RecentRequest[] = [];
    for (const r of [...feed, ...initial]) {
      const k = `${r.t}-${r.method}-${r.ms}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(r);
      if (merged.length >= 50) break;
    }
    return merged;
  }, [feed, initial, paused, frozen]);
  return (
    <Card>
      <CardHeader
        icon={<Activity />}
        title="Live feed"
        description="Every request as it comes in. Newest first."
        actions={
          <Button
            size="sm"
            aria-pressed={paused}
            onClick={() => {
              if (!paused) setFrozen(rows);
              setPaused((p) => !p);
            }}
          >
            {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
            {paused ? "Resume" : "Pause"}
          </Button>
        }
      />
      <CardBody className="pt-2">
        {rows.length === 0 ? (
          <EmptyState title="No requests yet">Requests appear here within a second of reaching the proxy.</EmptyState>
        ) : (
          <ol className="scrollbar-thin max-h-96 divide-y divide-border overflow-y-auto" aria-live="off">
            {rows.map((r) => (
              <li key={`${r.t}-${r.method}-${r.ms}`} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="num w-[8ch] shrink-0 text-xs text-muted">{fmtClock(r.t)}</span>
                {r.ok ? <CheckCircle2 className="size-3.5 shrink-0 text-ok" aria-label="ok" /> : <XCircle className="size-3.5 shrink-0 text-crit" aria-label="error" />}
                <span className="num w-[18ch] shrink-0 truncate text-fg">{r.method}</span>
                <span className="num min-w-0 flex-1 truncate text-xs text-muted" title={r.shapeId ? (shapes.get(r.shapeId) ?? r.shapeId) : undefined}>
                  {r.shapeId ? (shapes.get(r.shapeId) ?? r.shapeId) : r.batch ? "batch" : ""}
                </span>
                <span className={cn("num w-[9ch] shrink-0 text-right", r.ms >= slowMs ? "font-semibold text-warn" : "text-fg")}>{fmtMs(r.ms)}</span>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

export default function QueriesPage() {
  const user = useUser();
  const admin = user.role === "admin";
  const reduced = useReducedMotion();
  const [range, setRange] = useRange("1h");
  const [paused, setPaused] = useState<boolean>(!!reduced);
  const q = useLiveQueries(range, paused);
  const first = useFirstLoad("queries");
  const data = q.data;
  const state: QueryState = { isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch(), isFetching: q.isFetching };

  const rpmSeries = useMemo<ChartSeries[]>(() => {
    if (!data) return [];
    const order = ["arkiv_query", "eth_*", "arkiv_other", "other"];
    return [...data.series.requestsPerMin]
      .sort((a, b) => order.indexOf(a.labels.method ?? "") - order.indexOf(b.labels.method ?? ""))
      .map((s, i) => ({ key: s.labels.method ?? `s${i}`, label: groupLabel[s.labels.method ?? ""] ?? s.labels.method ?? "", points: s.points, color: s.labels.method === "other" ? OTHER_COLOR : seriesColor(i) }));
  }, [data]);
  const latencySeries = useMemo<ChartSeries[]>(() => {
    if (!data) return [];
    const pick = (list: typeof data.series.avgMs, g: string) => list.find((s) => s.labels.method === g)?.points ?? [];
    return [
      { key: "q_avg", label: "arkiv_query average", points: pick(data.series.avgMs, "arkiv_query"), color: seriesColor(0), dash: "" },
      { key: "q_p95", label: "arkiv_query p95", points: pick(data.series.p95Ms, "arkiv_query"), color: seriesColor(0), dash: "6 4" },
      { key: "q_max", label: "arkiv_query max", points: pick(data.series.maxMs, "arkiv_query"), color: seriesColor(3), dash: "2 3" },
      { key: "e_avg", label: "eth_* average", points: pick(data.series.avgMs, "eth_*"), color: seriesColor(1), dash: "" },
    ].filter((s) => s.points.length > 0);
  }, [data]);
  const errSeries = useMemo<ChartSeries[]>(() => (data ? [{ key: "err", label: "error rate", points: data.series.errorPct.points, color: seriesColor(5) }] : []), [data]);
  const shapeText = useMemo(() => new Map((data?.shapes ?? []).map((s) => [s.shapeId, s.shape])), [data]);
  const slowestShape = data?.shapes[0] ?? null;

  const shapeCols: Column<QueryShapeRow>[] = [
    { key: "shape", header: "Query shape", cell: (s) => <code className="num text-xs break-all whitespace-pre-wrap text-fg">{s.shape}</code>, sort: (s) => s.shape },
    { key: "count", header: "Requests", align: "right", cell: (s) => fmtNum(s.count), sort: (s) => s.count },
    { key: "avg", header: "Average", align: "right", cell: (s) => fmtMs(s.avgMs), sort: (s) => s.avgMs, hideBelow: "sm" },
    { key: "p95", header: "p95", align: "right", cell: (s) => fmtMs(s.p95Ms), sort: (s) => s.p95Ms },
    { key: "max", header: "Slowest", align: "right", cell: (s) => <span className={s.maxMs >= (data?.slowMs ?? 250) ? "font-semibold text-warn" : undefined}>{fmtMs(s.maxMs)}</span>, sort: (s) => s.maxMs, hideBelow: "md" },
    { key: "errors", header: "Errors", align: "right", cell: (s) => (s.errors ? <span className="text-crit">{fmtNum(s.errors)}</span> : "0"), sort: (s) => s.errors, hideBelow: "md" },
    { key: "last", header: "Last seen", align: "right", cell: (s) => <span className="num text-xs text-muted">{fmtAgo(s.lastSeen)}</span>, sort: (s) => s.lastSeen, hideBelow: "lg" },
  ];
  const slowCols: Column<SlowRequest>[] = [
    { key: "t", header: "When", cell: (r) => <span className="num text-xs text-muted" title={fmtDateTime(r.t)}>{fmtAgo(r.t)}</span>, sort: (r) => r.t },
    { key: "method", header: "Method", cell: (r) => <span className="num text-xs text-fg">{r.method}</span>, sort: (r) => r.method, hideBelow: "sm" },
    { key: "shape", header: "Query shape", cell: (r) => <code className="num text-xs break-all whitespace-pre-wrap text-muted">{r.shape ?? (r.shapeId ?? "")}</code>, sort: (r) => r.shape ?? "" },
    { key: "ms", header: "Latency", align: "right", cell: (r) => <span className="font-semibold text-warn">{fmtMs(r.ms)}</span>, sort: (r) => r.ms },
    { key: "ok", header: "Result", align: "right", cell: (r) => (r.ok ? <span className="text-ok">ok</span> : <span className="text-crit">error</span>), sort: (r) => (r.ok ? 1 : 0), hideBelow: "md" },
  ];

  return (
    <>
      <PageHeader
        title="Live queries"
        description="The read queries the pool sends to this node, timed one by one."
        actions={data ? <StatusBadge tone={data.mode === "inline" ? "ok" : "info"}>{data.mode === "inline" ? "Pool traffic" : "Local traffic only"}</StatusBadge> : null}
      />
      <ChartToolbar range={range} onRange={setRange} paused={paused} onPause={setPaused} updatedAt={q.dataUpdatedAt || undefined} />

      {q.isLoading ? (
        <div role="status" aria-label="Loading live queries" className="flex flex-col gap-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-24" />
          <Skeleton className="h-72" />
        </div>
      ) : q.error && !data ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : data ? (
        <div className="flex flex-col gap-4">
          <StaggerItem index={0} first={first}>
            <ModeCard data={data} admin={admin} />
          </StaggerItem>

          <StaggerItem index={1} first={first}>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Requests / min" icon={<Activity />} value={<AnimatedNumber value={data.live.rpm} format={(n) => fmtNum(n)} />} sub={`${fmtNum(data.live.requests)} in ${range}`} />
              <Tile label="Average" icon={<Gauge />} value={<AnimatedNumber value={data.live.avgMs} format={fmtMs} />} sub={`p50 ${fmtMs(data.live.p50Ms)}`} />
              <Tile
                label="p95"
                icon={<Clock />}
                value={<AnimatedNumber value={data.live.p95Ms} format={fmtMs} />}
                sub={slowestShape ? `slowest shape ${fmtMs(slowestShape.maxMs)}` : "no arkiv_query yet"}
                tone={(data.live.p95Ms ?? 0) >= data.slowMs ? "warn" : undefined}
              />
              <Tile
                label="Error rate"
                icon={<AlertTriangle />}
                value={<AnimatedNumber value={data.live.errorPct} format={(n) => (n == null ? DASH : fmtPct(n, 2))} />}
                sub={`${fmtNum(data.live.errors)} errors`}
                tone={(data.live.errorPct ?? 0) >= 5 ? "crit" : (data.live.errorPct ?? 0) >= 1 ? "warn" : undefined}
              />
            </dl>
          </StaggerItem>

          {data.mode !== "inline" && data.live.requests === 0 ? (
            <StaggerItem index={2} first={first}>
              <Card>
                <EmptyState title="Nothing to show yet" icon={<Radio />}>
                  {admin ? "Switch to inline above to watch the pool's queries arrive." : "An admin can switch the node to inline mode to watch the pool's queries."}
                </EmptyState>
              </Card>
            </StaggerItem>
          ) : null}

          <StaggerItem index={2} first={first}>
            <ChartCard
              title="Requests per minute"
              description="arkiv_query reads against everything else."
              state={state}
              isEmpty={rpmSeries.every((s) => s.points.length === 0)}
              emptyText={data.mode === "inline" ? "The load balancer's first requests arrive within a minute." : "No requests reached the proxy in this range."}
              height={280}
              summary={`${fmtNum(data.live.requests)} requests in ${range}, ${fmtNum(data.live.rpm)} in the last minute.`}
              chart={() => <TimeSeriesChart series={rpmSeries} kind="stacked" yFormat={(v) => `${fmtFixed(v, 1)} req/min`} yTickFormat={(v) => (v < 10 ? fmtFixed(v, 1) : fmtNum(v))} yUnit="req/min" height={280} />}
              table={() => <SeriesTable series={rpmSeries} format={(v) => fmtFixed(v, 1)} caption="Requests per minute" />}
            />
          </StaggerItem>

          <div className="grid gap-4 *:min-w-0 xl:grid-cols-[3fr_2fr]">
            <StaggerItem index={3} first={first}>
              <ChartCard
                title="Latency"
                description={`Average, p95 and slowest per 15 s. The slow line is ${data.slowMs} ms.`}
                state={state}
                isEmpty={latencySeries.length === 0}
                height={280}
                summary={`Average ${fmtMs(data.live.avgMs)}, p95 ${fmtMs(data.live.p95Ms)} in ${range}.`}
                chart={() => (
                  <TimeSeriesChart
                    series={latencySeries}
                    yFormat={fmtMs}
                    yTickFormat={(v) => fmtNum(v)}
                    yUnit="ms"
                    height={280}
                    refLines={[{ y: data.slowMs, label: "slow", tone: "warn" }]}
                  />
                )}
                table={() => <SeriesTable series={latencySeries} format={(v) => fmtFixed(v, 1)} caption="Latency" />}
              />
            </StaggerItem>
            <StaggerItem index={4} first={first}>
              <ChartCard
                title="Error rate"
                description="JSON-RPC errors and HTTP failures, as a share of requests."
                state={state}
                isEmpty={errSeries.every((s) => s.points.length === 0)}
                height={280}
                summary={`${fmtPct(data.live.errorPct ?? 0, 2)} over ${range}.`}
                chart={() => <TimeSeriesChart series={errSeries} kind="area" yFormat={(v) => fmtPct(v, 2)} yTickFormat={(v) => `${fmtFixed(v, 1)}`} yUnit="%" yDomain={[0, "auto"]} height={280} />}
                table={() => <SeriesTable series={errSeries} format={(v) => fmtFixed(v, 2)} caption="Error rate" />}
              />
            </StaggerItem>
          </div>

          <StaggerItem index={5} first={first}>
            <Card>
              <CardHeader
                icon={<Clock />}
                title="Slowest query shapes"
                description="Same query with different values = one shape. Values are replaced by ? and never stored."
                actions={
                  <Link to="/slow-queries" className="text-sm text-link underline-offset-2 hover:underline">
                    Benchmark shapes
                  </Link>
                }
              />
              <CardBody>
                {data.shapes.length === 0 ? (
                  <EmptyState title="No arkiv_query seen in this range" />
                ) : (
                  <DataTable rows={data.shapes} columns={shapeCols} rowKey={(s) => s.shapeId} caption="Query shapes, slowest p95 first" initialSort={{ key: "p95", dir: "desc" }} dense />
                )}
              </CardBody>
            </Card>
          </StaggerItem>

          <div className="grid gap-4 *:min-w-0 xl:grid-cols-2">
            <StaggerItem index={6} first={first}>
              <Card className="h-full">
                <CardHeader icon={<TriangleAlert />} title="Slowest requests" description={`Single requests over ${data.slowMs} ms.`} />
                <CardBody>
                  {data.slowest.length === 0 ? (
                    <EmptyState title={`Nothing over ${data.slowMs} ms`}>Good news: every request in this range came back under the slow line.</EmptyState>
                  ) : (
                    <DataTable rows={data.slowest} columns={slowCols} rowKey={(r) => `${r.t}-${r.ms}`} caption="Slowest requests" initialSort={{ key: "ms", dir: "desc" }} dense />
                  )}
                </CardBody>
              </Card>
            </StaggerItem>
            <StaggerItem index={7} first={first}>
              <LiveFeed initial={data.recent} shapes={shapeText} slowMs={data.slowMs} />
            </StaggerItem>
          </div>
        </div>
      ) : null}
    </>
  );
}
