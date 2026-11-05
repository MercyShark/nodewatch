import { useState } from "react";
import { useReducedMotion } from "framer-motion";
import { CheckCheck, RefreshCcw } from "lucide-react";
import type { Series } from "@nodewatch/shared";
import { useChain, useOverview } from "@/lib/queries";
import { useRange } from "@/lib/useRange";
import { fmtBlocksAsTime, fmtDuration, fmtNum } from "@/lib/format";
import { ChartToolbar, PageHeader } from "@/components/layout/PageHeader";
import { ChartCard } from "@/charts/ChartCard";
import { SeriesTable, TimeSeriesChart } from "@/charts/TimeSeriesChart";
import type { ChartSeries } from "@/charts/theme";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, type Tone } from "@/components/ui/status";
import { Skeleton } from "@/components/ui/feedback";
import { AnimatedNumber } from "@/components/ui/animated-number";

const s = (key: string, label: string, x: Series | undefined, color?: string, dash?: string): ChartSeries => ({
  key,
  label,
  points: x?.points ?? [],
  color,
  dash,
});
const blk = (v: number) => `${fmtNum(v)} blocks`;

function Stat({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-bg/50 p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{children}</dd>
      {sub ? <dd className="text-xs text-muted">{sub}</dd> : null}
    </div>
  );
}

export default function Chain() {
  const [range, setRange] = useRange("6h");
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(!!reduced);
  const q = useChain(range, paused);
  const ov = useOverview();
  const d = q.data;
  const k = ov.data?.kpis;
  const st = { isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch(), isFetching: q.isFetching };
  const lag = k?.headLag ?? d?.lag.points[d.lag.points.length - 1]?.v ?? null;
  const syncTone: Tone = d?.syncing ? "warn" : lag != null && lag > 10 ? "warn" : d ? "ok" : "neutral";
  const eta =
    d?.syncing && d.syncDistance != null && d.catchUpBlocksPerMin
      ? (d.syncDistance / d.catchUpBlocksPerMin) * 60
      : lag != null && lag > 10 && d?.catchUpBlocksPerMin
        ? (lag / d.catchUpBlocksPerMin) * 60
        : null;

  return (
    <>
      <PageHeader
        title="Chain"
        description="Our head against the network, lag, peers, finality and sync. If the reference RPC fails, no lag verdict is shown."
      />
      <ChartToolbar range={range} onRange={setRange} paused={paused} onPause={setPaused} updatedAt={q.dataUpdatedAt || undefined} />

      <Card className="mb-4">
        <CardHeader
          title="Sync status"
          icon={<RefreshCcw />}
          actions={
            d ? (
              <StatusBadge tone={syncTone}>
                {d.syncing ? "Syncing" : lag != null && lag > 10 ? "Behind" : "In sync"}
              </StatusBadge>
            ) : null
          }
        />
        <CardBody>
          {q.isLoading && !k ? (
            <Skeleton className="h-20" />
          ) : (
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Our head">
                <AnimatedNumber value={k?.headBlock ?? null} format={(n) => fmtNum(n)} />
              </Stat>
              <Stat label="Network head">
                <AnimatedNumber value={k?.referenceHead ?? null} format={(n) => fmtNum(n)} />
              </Stat>
              <Stat label="Lag" sub={lag != null ? `≈ ${fmtBlocksAsTime(lag)} (2 s blocks)` : "reference unavailable"}>
                <AnimatedNumber value={lag} format={(n) => (n == null ? "—" : `${fmtNum(n)} blk`)} />
              </Stat>
              <Stat label="Sync distance (CL)" sub={eta != null ? `ETA ${fmtDuration(eta)} at ${fmtNum(d?.catchUpBlocksPerMin)} blk/min` : "slots"}>
                <span className="num">{fmtNum(d?.syncDistance)}</span>
              </Stat>
              <Stat label="Finalized epoch" sub={<span className="inline-flex items-center gap-1"><CheckCheck className="size-3.5" aria-hidden />32 slots / epoch</span>}>
                <span className="num">{fmtNum(d?.finalizedEpoch)}</span>
              </Stat>
              <Stat
                label="Justified epoch"
                sub={
                  d?.finalizedEpoch != null && d.justifiedEpoch != null
                    ? `${d.justifiedEpoch - d.finalizedEpoch} ahead of finalized`
                    : undefined
                }
              >
                <span className="num">{fmtNum(d?.justifiedEpoch)}</span>
              </Stat>
            </dl>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Head vs network"
          description="Ours vs the reference RPC"
          state={st}
          isEmpty={!d || d.head.points.length === 0}
          height={280}
          summary={lag != null ? `Our node is ${lag} blocks behind the network.` : undefined}
          chart={() => (
            <TimeSeriesChart
              series={[s("ref", "Network (reference)", d?.reference, "#22D3EE", "6 4"), s("head", "Our head", d?.head, "#3B82F6", "")]}
              yFormat={(v) => `#${fmtNum(v)}`}
              yTickFormat={(v) => (v >= 1000 ? `${fmtNum(v / 1000, 1)}k` : fmtNum(v))}
              yUnit="block height"
              yDomain={["auto", "auto"]}
              height={280}
            />
          )}
          table={() => (
            <SeriesTable series={[s("ref", "Network", d?.reference), s("head", "Ours", d?.head)]} format={(v) => fmtNum(v)} caption="Head vs network" />
          )}
        />
        <ChartCard
          title="Head lag"
          description="The load balancer skips nodes more than 10 blocks behind."
          state={st}
          isEmpty={!d || d.lag.points.length === 0}
          height={280}
          chart={() => (
            <TimeSeriesChart
              series={[s("lag", "Lag", d?.lag, "#A78BFA")]}
              kind="area"
              yFormat={(v) => `${blk(v)} (${fmtBlocksAsTime(v)})`}
              yTickFormat={(v) => fmtNum(v)}
              yUnit="blocks behind"
              yDomain={[0, "auto"]}
              refLines={[{ y: 10, label: "10-block threshold", tone: "warn" }]}
              height={280}
            />
          )}
          table={() => <SeriesTable series={[s("lag", "Lag (blocks)", d?.lag)]} format={(v) => fmtNum(v)} caption="Head lag" />}
        />
        <ChartCard
          title="Peers"
          description="Execution and consensus"
          state={st}
          isEmpty={!d || (d.peersEl.points.length === 0 && d.peersCl.points.length === 0)}
          height={260}
          className="xl:col-span-2"
          chart={() => (
            <TimeSeriesChart
              series={[s("el", "Execution peers", d?.peersEl), s("cl", "Consensus peers", d?.peersCl)]}
              yFormat={(v) => `${fmtNum(v)} peers`}
              yTickFormat={(v) => fmtNum(v)}
              yUnit="peers"
              yDomain={[0, "auto"]}
              height={260}
            />
          )}
          table={() => (
            <SeriesTable series={[s("el", "Execution", d?.peersEl), s("cl", "Consensus", d?.peersCl)]} format={(v) => fmtNum(v)} caption="Peers" />
          )}
        />
      </div>
    </>
  );
}
