import { useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeftRight, Info, TriangleAlert } from "lucide-react";
import type { RpcResponse, SeriesPoint } from "@nodewatch/shared";
import { ChartToolbar, PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, type Column } from "@/components/ui/table";
import { StaggerItem, useFirstLoad } from "@/components/ui/stagger-item";
import { ChartCard, type QueryState } from "@/charts/ChartCard";
import { SeriesTable, TimeSeriesChart } from "@/charts/TimeSeriesChart";
import { AXIS, GRID, OTHER_COLOR, seriesColor, seriesDash, type ChartSeries } from "@/charts/theme";
import { AxisCaption, TooltipBox } from "@/charts/parts";
import { fmtFixed, fmtNum, fmtPct, DASH } from "@/lib/format";
import { useRpc } from "@/lib/queries";
import { useRange } from "@/lib/useRange";

type MethodRow = RpcResponse["methods"][number];
const errPct = (m: MethodRow) => (m.requests > 0 ? (m.errors / m.requests) * 100 : 0);
const fmtMs = (v: number | null | undefined) => (v == null ? DASH : `${fmtFixed(v, v < 10 ? 1 : 0)} ms`);

/** Top 5 methods by requests keep their own colour; the rest fold into "Other" (max 6 series). */
function foldSeries(data: RpcResponse): ChartSeries[] {
  const total = (pts: SeriesPoint[]) => pts.reduce((a, p) => a + p.v, 0);
  const named = data.requestsPerMin.map((s) => ({
    method: s.labels.method ?? s.metric,
    points: s.points,
    sum: total(s.points),
  }));
  named.sort((a, b) => b.sum - a.sum);
  const top = named.slice(0, 5);
  const rest = named.slice(5);
  const out: ChartSeries[] = top.map((s, i) => ({
    key: `m${i}`,
    label: s.method,
    points: s.points,
    color: seriesColor(i),
    dash: seriesDash(i),
  }));
  if (rest.length) {
    const acc = new Map<number, number>();
    for (const s of rest) for (const p of s.points) acc.set(p.t, (acc.get(p.t) ?? 0) + p.v);
    out.push({
      key: "other",
      label: `Other (${rest.length})`,
      points: [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v })),
      color: OTHER_COLOR,
    });
  }
  return out;
}

function MethodBars({
  rows,
  value,
  format,
  color,
  unit,
  label,
}: {
  rows: MethodRow[];
  value: (m: MethodRow) => number | null;
  format: (v: number) => string;
  color: string;
  unit: string;
  label: string;
}) {
  const data = rows
    .map((m) => ({ method: m.method, v: value(m) }))
    .filter((d): d is { method: string; v: number } => d.v != null)
    .sort((a, b) => b.v - a.v);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 w-full min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" stroke={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(v: number) => format(v)} />
            <YAxis
              type="category"
              dataKey="method"
              stroke={AXIS}
              tickLine={false}
              axisLine={false}
              width={132}
              interval={0}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(147,163,191,0.08)" }}
              isAnimationActive={false}
              content={(p) => {
                const props = p as unknown as { active?: boolean; payload?: { payload?: { method: string; v: number } }[] };
                const d = props.payload?.[0]?.payload;
                if (!props.active || !d) return null;
                return <TooltipBox title={d.method} rows={[{ key: "v", label, value: format(d.v), color }]} />;
              }}
            />
            <Bar dataKey="v" name={label} fill={color} radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <AxisCaption y="method" x={`${unit} →`} />
    </div>
  );
}

function ProxyModeCard({ mode }: { mode: RpcResponse["proxyMode"] }) {
  const revert = "docker compose -p arkiv-community-node restart tunnel";
  if (mode === "inline") {
    return (
      <Card className="border-warn/40">
        <CardHeader
          icon={<TriangleAlert />}
          title="Inline proxy mode"
          actions={<StatusBadge tone="warn">Inline: pool traffic</StatusBadge>}
          description="frpc forwards the load balancer's requests to Nodewatch on :18545, so these numbers are real pool traffic."
        />
        <CardBody className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            A Nodewatch restart now interrupts paid serving until it is back up. The proxy is fail-open, but it is still in the path. To
            revert, set frpc's local target back to <code className="num text-fg">execution:8545</code> and restart the tunnel:
          </p>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg pl-3">
            <code className="num min-w-0 flex-1 truncate text-xs text-fg">{revert}</code>
            <CopyButton text={revert} label="Copy revert command" />
          </div>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        icon={<Info />}
        title="Passive proxy mode"
        actions={<StatusBadge tone="info">Passive: local traffic only</StatusBadge>}
        description="The safe default. These charts are not pool traffic."
      />
      <CardBody>
        <p className="text-sm text-muted">
          Nodewatch measures only requests sent to its listener on <code className="num text-fg">:18545</code>: its own probes, slow-query
          benchmarks and local tools. The load balancer keeps talking to the node directly through the tunnel, so paid requests do not
          appear here (see Pool & earnings for counted requests). Inline mode shows pool traffic but puts Nodewatch in the serving path.
        </p>
      </CardBody>
    </Card>
  );
}

export default function RpcPage() {
  const reduced = useReducedMotion();
  const [range, setRange] = useRange("1h");
  const [paused, setPaused] = useState<boolean>(!!reduced);
  const q = useRpc(range, paused);
  const first = useFirstLoad("rpc");
  const data = q.data;
  const state: QueryState = { isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch(), isFetching: q.isFetching };

  const series = useMemo(() => (data ? foldSeries(data) : []), [data]);
  const methods = data?.methods ?? [];
  const totals = useMemo(() => {
    const req = methods.reduce((a, m) => a + m.requests, 0);
    const err = methods.reduce((a, m) => a + m.errors, 0);
    const slow = methods.reduce<MethodRow | null>((a, m) => ((m.p95Ms ?? -1) > (a?.p95Ms ?? -1) ? m : a), null);
    return { req, err, slow };
  }, [methods]);

  const barHeight = Math.max(160, methods.length * 30 + 40);
  const fmtRpm = (v: number) => `${fmtFixed(v, v < 10 ? 1 : 0)} req/min`;

  const columns: Column<MethodRow>[] = [
    { key: "method", header: "Method", cell: (m) => <span className="num text-xs break-all text-fg">{m.method}</span>, sort: (m) => m.method },
    { key: "requests", header: "Requests", align: "right", cell: (m) => fmtNum(m.requests), sort: (m) => m.requests },
    { key: "errors", header: "Errors", align: "right", cell: (m) => fmtNum(m.errors), sort: (m) => m.errors, hideBelow: "md" },
    { key: "errPct", header: "Error %", align: "right", cell: (m) => fmtPct(errPct(m), 2), sort: errPct, hideBelow: "sm" },
    { key: "p50", header: "p50", align: "right", cell: (m) => fmtMs(m.p50Ms), sort: (m) => m.p50Ms, hideBelow: "md" },
    { key: "p95", header: "p95", align: "right", cell: (m) => fmtMs(m.p95Ms), sort: (m) => m.p95Ms },
  ];

  return (
    <>
      <PageHeader
        title="RPC traffic"
        description="Requests and latency per JSON-RPC method, measured by Nodewatch's built-in proxy listener."
        actions={
          data ? (
            data.proxyMode === "inline" ? (
              <StatusBadge tone="warn">Proxy: inline</StatusBadge>
            ) : (
              <StatusBadge tone="info">Proxy: passive</StatusBadge>
            )
          ) : null
        }
      />
      <ChartToolbar range={range} onRange={setRange} paused={paused} onPause={setPaused} updatedAt={q.dataUpdatedAt || undefined} />

      {q.isLoading ? (
        <div role="status" aria-label="Loading RPC traffic" className="flex flex-col gap-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-72" />
        </div>
      ) : q.error && !data ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : data ? (
        <div className="flex flex-col gap-4">
          <StaggerItem index={0} first={first}>
            <ProxyModeCard mode={data.proxyMode} />
          </StaggerItem>

          <StaggerItem index={1} first={first}>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Requests", fmtNum(totals.req), `in ${range}`],
                ["Error rate", fmtPct(totals.req ? (totals.err / totals.req) * 100 : 0, 2), `${fmtNum(totals.err)} errors`],
                ["Methods", fmtNum(methods.length), "seen in range"],
                ["Slowest p95", fmtMs(totals.slow?.p95Ms), totals.slow?.method ?? DASH],
              ].map(([label, value, sub]) => (
                <div key={label} className="min-w-0 rounded-xl border border-border bg-surface p-4">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="num mt-1 text-xl font-semibold text-fg">{value}</dd>
                  <dd className="num truncate text-xs text-muted">{sub}</dd>
                </div>
              ))}
            </dl>
          </StaggerItem>

          <StaggerItem index={2} first={first}>
            <ChartCard
              title="Requests per minute by method"
              description="Stacked; the top 5 methods by volume, the rest folded into Other."
              state={state}
              isEmpty={series.every((s) => s.points.length === 0)}
              emptyText="No requests reached the proxy in this range. In passive mode only local probes and benchmarks appear."
              height={300}
              summary={`${fmtNum(totals.req)} requests in ${range}; busiest method ${series[0]?.label ?? "none"}.`}
              chart={() => (
                <TimeSeriesChart series={series} kind="stacked" yFormat={fmtRpm} yTickFormat={(v) => fmtNum(v)} yUnit="req/min" height={300} />
              )}
              table={() => <SeriesTable series={series} format={(v) => fmtFixed(v, 1)} caption="Requests per minute by method" />}
            />
          </StaggerItem>

          <div className="grid gap-4 xl:grid-cols-2">
            <StaggerItem index={3} first={first}>
              <ChartCard
                title="p95 latency per method"
                description="95th percentile response time in this range."
                state={state}
                isEmpty={methods.length === 0}
                height={barHeight}
                summary={totals.slow ? `Slowest p95: ${totals.slow.method} at ${fmtMs(totals.slow.p95Ms)}.` : undefined}
                chart={() => (
                  <MethodBars rows={methods} value={(m) => m.p95Ms} format={(v) => `${fmtNum(v)} ms`} color={seriesColor(0)} unit="ms" label="p95" />
                )}
                table={() => (
                  <DataTable
                    rows={methods}
                    columns={[columns[0]!, columns[4]!, columns[5]!].map((c) => ({ ...c, hideBelow: undefined }))}
                    rowKey={(m) => m.method}
                    caption="Latency per method"
                    initialSort={{ key: "p95", dir: "desc" }}
                    dense
                  />
                )}
              />
            </StaggerItem>
            <StaggerItem index={4} first={first}>
              <ChartCard
                title="Error rate per method"
                description="Share of requests that returned a JSON-RPC or HTTP error."
                state={state}
                isEmpty={methods.length === 0}
                height={barHeight}
                summary={`Overall error rate ${fmtPct(totals.req ? (totals.err / totals.req) * 100 : 0, 2)}.`}
                chart={() => (
                  <MethodBars rows={methods} value={errPct} format={(v) => `${fmtFixed(v, 2)} %`} color={seriesColor(2)} unit="% of requests" label="error rate" />
                )}
                table={() => (
                  <DataTable
                    rows={methods}
                    columns={[columns[0]!, columns[1]!, columns[2]!, columns[3]!].map((c) => ({ ...c, hideBelow: undefined }))}
                    rowKey={(m) => m.method}
                    caption="Errors per method"
                    initialSort={{ key: "errPct", dir: "desc" }}
                    dense
                  />
                )}
              />
            </StaggerItem>
          </div>

          <StaggerItem index={5} first={first}>
            <Card>
              <CardHeader icon={<ArrowLeftRight />} title="Methods" description="All methods seen by the proxy in this range. Sort by any column." />
              <CardBody>
                <DataTable
                  rows={methods}
                  columns={columns}
                  rowKey={(m) => m.method}
                  caption="Per-method requests, errors and latency"
                  initialSort={{ key: "requests", dir: "desc" }}
                />
              </CardBody>
            </Card>
          </StaggerItem>
        </div>
      ) : null}
    </>
  );
}
