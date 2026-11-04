import { useState } from "react";
import { useReducedMotion } from "framer-motion";
import { CalendarClock, Gauge, HardDrive } from "lucide-react";
import type { ResourcesResponse, Series, ServiceName } from "@nodewatch/shared";
import { useDiskForecast, useOverview, useResources } from "@/lib/queries";
import { useRange } from "@/lib/useRange";
import { fmtFixed, fmtGB, fmtNum, fmtPct, fmtRate, GB } from "@/lib/format";
import { ChartToolbar, PageHeader } from "@/components/layout/PageHeader";
import { ChartCard, type QueryState } from "@/charts/ChartCard";
import { SeriesTable, TimeSeriesChart } from "@/charts/TimeSeriesChart";
import { ForecastChart, ForecastTable } from "@/charts/ForecastChart";
import type { ChartSeries } from "@/charts/theme";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, type Tone } from "@/components/ui/status";
import { ErrorState, Skeleton } from "@/components/ui/feedback";

const s = (key: string, label: string, series: Series | undefined): ChartSeries => ({ key, label, points: series?.points ?? [] });
const SERVICES: ServiceName[] = ["execution", "consensus", "tunnel"];
const pctTick = (v: number) => `${fmtNum(v)}`;
const gbTick = (v: number) => fmtFixed(v / GB, v / GB < 10 ? 1 : 0);
const rateTick = (v: number) => (v >= 1e6 ? `${fmtFixed(v / 1e6, 1)}M` : v >= 1e3 ? `${fmtNum(v / 1e3)}k` : fmtNum(v));

function useSeriesCard(q: { isLoading: boolean; error: unknown; refetch: () => unknown; isFetching: boolean }): QueryState {
  return { isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch(), isFetching: q.isFetching };
}

function SeriesCard({
  title,
  description,
  state,
  series,
  format,
  tick,
  unit,
  kind,
  refLines,
  yDomain,
  summary,
}: {
  title: string;
  description?: string;
  state: QueryState;
  series: ChartSeries[];
  format: (v: number) => string;
  tick?: (v: number) => string;
  unit: string;
  kind?: "line" | "area" | "stacked";
  refLines?: { y: number; label: string; tone: "warn" | "crit" | "neutral" }[];
  yDomain?: [number | "auto", number | "auto"];
  summary?: string;
}) {
  return (
    <ChartCard
      title={title}
      description={description}
      state={state}
      isEmpty={series.every((x) => x.points.length === 0)}
      summary={summary}
      height={260}
      chart={() => (
        <TimeSeriesChart series={series} yFormat={format} yTickFormat={tick} yUnit={unit} kind={kind} refLines={refLines} yDomain={yDomain} height={260} />
      )}
      table={() => <SeriesTable series={series} format={format} caption={title} />}
    />
  );
}

function latest(x: Series | undefined): number | null {
  return x?.points[x.points.length - 1]?.v ?? null;
}

function ForecastCard() {
  const q = useDiskForecast();
  const f = q.data;
  const tone: Tone =
    f?.daysToFull == null ? "neutral" : f.daysToFull < f.thresholds.critDays ? "crit" : f.daysToFull < f.thresholds.warnDays ? "warn" : "ok";
  const daysText = f?.daysToFull == null ? "No trend yet" : f.daysToFull > 999 ? "Full in 999+ days" : `Full in ${fmtFixed(f.daysToFull, 1)} days`;
  return (
    <ChartCard
      title="Disk forecast"
      description="Chain data (el-data + cl-data) with a linear projection to the point the root volume fills."
      state={{ isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() }}
      isEmpty={!f || f.samples.length < 2}
      emptyText="The forecast needs at least two samples (taken every 5 minutes)."
      height={320}
      summary={f ? `${daysText} at ${fmtGB(f.ratePerDay24h)} per day.` : undefined}
      actions={f ? <StatusBadge tone={tone}>{daysText}</StatusBadge> : null}
      chart={() => (f ? <ForecastChart forecast={f} height={320} /> : null)}
      table={() => (f ? <ForecastTable forecast={f} /> : null)}
      footer={
        f ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border px-4 py-4 text-sm sm:grid-cols-3 sm:px-5 xl:grid-cols-6">
            {[
              ["Free", fmtGB(f.freeBytes, 0)],
              ["Total", fmtGB(f.totalBytes, 0)],
              ["el-data", fmtGB(f.volumes.el)],
              ["cl-data", fmtGB(f.volumes.cl)],
              ["Rate (6 h)", f.ratePerDay6h == null ? "—" : `${fmtGB(f.ratePerDay6h, 2)}/day`],
              ["Rate (24 h)", f.ratePerDay24h == null ? "—" : `${fmtGB(f.ratePerDay24h, 2)}/day`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="num">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null
      }
    />
  );
}

function HostSummary({ data }: { data: ResourcesResponse | undefined }) {
  const ov = useOverview();
  const k = ov.data?.kpis;
  const items: [string, string][] = [
    ["CPU now", fmtPct(k?.cpuPct ?? latest(data?.host.cpuPct))],
    ["Load (1 min)", fmtFixed(latest(data?.host.load1), 2)],
    ["Memory", `${fmtGB(k?.memUsedBytes ?? latest(data?.host.memUsedBytes))} / ${fmtGB(k?.memTotalBytes, 0)}`],
    ["Disk used", `${fmtGB(latest(data?.host.diskUsedBytes), 0)} / ${fmtGB(k?.diskTotalBytes, 0)}`],
    ["Disk write", fmtRate(latest(data?.host.diskWriteBps))],
    ["Net in / out", `${fmtRate(latest(data?.host.netRxBps))} / ${fmtRate(latest(data?.host.netTxBps))}`],
  ];
  return (
    <Card>
      <CardHeader title="Host now" icon={<Gauge />} description="r7i.2xlarge · 8 vCPU · 64 GB RAM · 1,000 GiB gp3" />
      <CardBody>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-3 xl:grid-cols-6">
          {items.map(([k2, v]) => (
            <div key={k2} className="min-w-0">
              <dt className="text-xs text-muted">{k2}</dt>
              <dd className="num truncate">{data || k ? v : <Skeleton className="h-5 w-20" />}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

export default function Resources() {
  const [range, setRange] = useRange("6h");
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(!!reduced);
  const q = useResources(range, paused);
  const ov = useOverview();
  const st = useSeriesCard(q);
  const d = q.data;
  const memTotal = ov.data?.kpis.memTotalBytes ?? null;

  return (
    <>
      <PageHeader
        title="Resources"
        description="Host and per-container CPU, memory, disk, I/O and network. The node always wins resources; Nodewatch is capped at 2 vCPU / 3 GiB."
      />
      <ChartToolbar range={range} onRange={setRange} paused={paused} onPause={setPaused} updatedAt={q.dataUpdatedAt || undefined} />
      {q.error && !d ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : null}
      <div className="flex flex-col gap-4">
        <HostSummary data={d} />
        <ForecastCard />
        <h2 className="mt-2 flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
          <HardDrive className="size-4" aria-hidden /> Host
        </h2>
        <div className="grid gap-4 xl:grid-cols-2">
          <SeriesCard
            title="CPU"
            description="Host CPU, % of 8 vCPU"
            state={st}
            series={[s("cpu", "CPU", d?.host.cpuPct)]}
            format={(v) => fmtPct(v)}
            tick={pctTick}
            unit="%"
            kind="area"
            yDomain={[0, 100]}
            refLines={[{ y: 90, label: "90 % alert", tone: "warn" }]}
          />
          <SeriesCard
            title="Memory"
            description="Host memory used, GB"
            state={st}
            series={[s("mem", "Used", d?.host.memUsedBytes)]}
            format={(v) => fmtGB(v)}
            tick={gbTick}
            unit="GB"
            kind="area"
            yDomain={[0, memTotal ?? "auto"]}
            refLines={memTotal ? [{ y: memTotal * 0.9, label: "90 % alert", tone: "warn" }] : undefined}
          />
          <SeriesCard
            title="Disk I/O"
            description="Root volume throughput (gp3: 300 MiB/s provisioned)"
            state={st}
            series={[s("read", "Read", d?.host.diskReadBps), s("write", "Write", d?.host.diskWriteBps)]}
            format={(v) => fmtRate(v)}
            tick={rateTick}
            unit="bytes/s"
          />
          <SeriesCard
            title="Network"
            description="Host network throughput"
            state={st}
            series={[s("rx", "Received", d?.host.netRxBps), s("tx", "Sent", d?.host.netTxBps)]}
            format={(v) => fmtRate(v)}
            tick={rateTick}
            unit="bytes/s"
          />
          <SeriesCard
            title="Disk used"
            description="Root volume used, GB"
            state={st}
            series={[s("disk", "Used", d?.host.diskUsedBytes)]}
            format={(v) => fmtGB(v)}
            tick={gbTick}
            unit="GB"
          />
          <SeriesCard
            title="Load average"
            description="1-minute load (8 vCPU)"
            state={st}
            series={[s("load", "Load 1m", d?.host.load1)]}
            format={(v) => fmtFixed(v, 2)}
            unit="runnable tasks"
            refLines={[{ y: 8, label: "8 vCPU", tone: "neutral" }]}
          />
        </div>
        <h2 className="mt-2 text-sm font-semibold tracking-wide text-muted uppercase">Node containers</h2>
        <div className="grid gap-4 xl:grid-cols-2">
          <SeriesCard
            title="Container CPU"
            description="% of one vCPU per container (Docker stats)"
            state={st}
            series={SERVICES.map((svc) => s(svc, svc, d?.containers[svc]?.cpuPct))}
            format={(v) => fmtPct(v)}
            tick={pctTick}
            unit="%"
          />
          <SeriesCard
            title="Container memory"
            description="Resident memory per container, GB"
            state={st}
            series={SERVICES.map((svc) => s(svc, svc, d?.containers[svc]?.memBytes))}
            format={(v) => (v < 1e9 ? `${fmtNum(v / 1e6)} MB` : fmtGB(v, 2))}
            tick={gbTick}
            unit="GB"
          />
        </div>
        <p className="flex items-center gap-2 text-xs text-muted">
          <CalendarClock className="size-3.5" aria-hidden /> Ranges up to 6 h use raw 15 s samples; longer ranges use 5-minute rollups.
        </p>
      </div>
    </>
  );
}
