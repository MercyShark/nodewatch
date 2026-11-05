import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Box,
  Coins,
  Cpu,
  Fuel,
  HardDrive,
  HeartPulse,
  MemoryStick,
  Network,
  Timer,
  Terminal,
} from "lucide-react";
import type { AlertEvent, ContainerState, HeartbeatState, Kpis, Overview as OverviewT, Verdict } from "@nodewatch/shared";
import { useOverview } from "@/lib/queries";
import { DUR, EASE_IN, EASE_OUT, isFirstLoad, useMotionOk } from "@/lib/motion";
import {
  fmtAgo,
  fmtBlocksAsTime,
  fmtDateTime,
  fmtDuration,
  fmtFixed,
  fmtGB,
  fmtNum,
  fmtPct,
} from "@/lib/format";
import { explorerAddress, explorerEntity, explorerTx } from "@/lib/config";
import { PageHeader } from "@/components/layout/PageHeader";
import { HeartbeatIndicator } from "@/components/layout/Heartbeat";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge, ToneIcon, severityTone, toneVar, type Tone } from "@/components/ui/status";
import { CopyButton, Hex } from "@/components/ui/copy";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ExpiryRing, useNow } from "@/components/ui/time";
import { cn } from "@/lib/cn";

function VerdictHero({ verdict }: { verdict: Verdict }) {
  const motionOk = useMotionOk();
  const tone = severityTone(verdict.severity);
  const now = useNow(30_000);
  const label = { ok: "Healthy", warn: "Warning", crit: "Critical", info: "Info", neutral: "Unknown" }[tone];
  return (
    <section
      aria-labelledby="verdict-title"
      aria-live="polite"
      className="relative overflow-hidden rounded-xl border bg-surface transition-colors"
      style={{
        borderColor: `color-mix(in oklab, ${toneVar[tone]} 45%, var(--border))`,
        transitionDuration: "350ms",
      }}
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 transition-colors"
        style={{ background: toneVar[tone], transitionDuration: "350ms" }}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${verdict.code}-${verdict.title}`}
          initial={motionOk ? { opacity: 0, y: 10 } : false}
          animate={{ opacity: 1, y: 0, transition: { duration: DUR.complex, ease: EASE_OUT } }}
          exit={motionOk ? { opacity: 0, y: -6, transition: { duration: DUR.standard * 0.65, ease: EASE_IN } } : { opacity: 0 }}
          className="relative flex flex-col gap-3 p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={tone}>{label}</StatusBadge>
            <Badge className="num">{verdict.code}</Badge>
            <span className="text-xs text-muted">
              since <span className="num">{fmtAgo(verdict.since, now)}</span>
            </span>
          </div>
          <h2 id="verdict-title" className="max-w-4xl text-xl leading-snug font-semibold text-fg sm:text-2xl">
            {verdict.title}
          </h2>
          <p className="max-w-3xl text-sm text-muted sm:text-base">{verdict.detail}</p>
          {verdict.fix ? (
            <div className="mt-1">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted uppercase">
                <Terminal className="size-3.5" aria-hidden /> Fix
              </p>
              <div className="flex items-start gap-1 rounded-lg border border-border bg-bg py-1 pr-1 pl-3">
                <code className="num min-w-0 flex-1 py-2 text-sm break-all whitespace-pre-wrap text-[#bfdbfe]">{verdict.fix}</code>
                <CopyButton text={verdict.fix} label="Copy fix command" />
              </div>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

function Tile({
  label,
  icon,
  value,
  sub,
  tone,
  toneText,
  to,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  toneText?: string;
  to?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted uppercase">
          <span className="[&>svg]:size-3.5" aria-hidden>
            {icon}
          </span>
          {label}
        </p>
        {tone && tone !== "ok" ? (
          <span className="flex items-center gap-1 text-xs text-fg">
            <ToneIcon tone={tone} className="size-3.5" />
            {toneText}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-semibold text-fg">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}
    </>
  );
  const cls = cn(
    "relative block h-full overflow-hidden rounded-xl border bg-surface p-4",
    tone === "crit" ? "border-crit/50" : tone === "warn" ? "border-warn/45" : "border-border",
    to && "transition-colors hover:border-[#33466f] hover:bg-[#101a2e]",
    "before:absolute before:inset-x-0 before:top-0 before:h-px before:content-['']",
    tone === "crit" ? "before:bg-crit/70" : tone === "warn" ? "before:bg-warn/70" : "before:bg-primary/40",
  );
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function KpiGrid({ k, stagger }: { k: Kpis; stagger: boolean }) {
  const motionOk = useMotionOk();
  const memPct = k.memUsedBytes != null && k.memTotalBytes ? (k.memUsedBytes / k.memTotalBytes) * 100 : null;
  const lagTone: Tone = k.headLag == null ? "neutral" : k.headLag > 10 ? "warn" : "ok";
  const peersTone: Tone = k.peersEl === 0 || k.peersCl === 0 ? "crit" : "ok";
  const diskTone: Tone = k.diskDaysLeft == null ? "neutral" : k.diskDaysLeft < 2 ? "crit" : k.diskDaysLeft < 7 ? "warn" : "ok";
  const cpuTone: Tone = (k.cpuPct ?? 0) > 90 ? "warn" : "ok";
  const memTone: Tone = (memPct ?? 0) > 90 ? "warn" : "ok";
  const gasTone: Tone = k.heartbeatBalanceGlm != null && k.heartbeatBalanceGlm < 0.1 ? "warn" : "ok";

  const tiles: ReactNode[] = [
    <Tile
      key="lag"
      to="/chain"
      label="Head lag"
      icon={<Timer />}
      tone={lagTone}
      toneText="behind"
      value={<AnimatedNumber value={k.headLag} format={(n) => (n == null ? "—" : `${fmtNum(n)} blk`)} />}
      sub={
        <>
          {k.headLag != null ? `≈ ${fmtBlocksAsTime(k.headLag)} · ` : ""}head <span className="num">{fmtNum(k.headBlock)}</span>
          {k.syncing ? " · syncing" : ""}
        </>
      }
    />,
    <Tile
      key="peers"
      to="/chain"
      label="Peers"
      icon={<Network />}
      tone={peersTone}
      toneText="no peers"
      value={
        <span className="num">
          <AnimatedNumber value={k.peersEl} format={(n) => fmtNum(n)} />
          <span className="text-muted"> / </span>
          <AnimatedNumber value={k.peersCl} format={(n) => fmtNum(n)} />
        </span>
      }
      sub="execution / consensus"
    />,
    <Tile
      key="disk"
      to="/resources"
      label="Disk days left"
      icon={<HardDrive />}
      tone={diskTone}
      toneText={diskTone === "crit" ? "critical" : "low"}
      value={<AnimatedNumber value={k.diskDaysLeft} format={(n) => (n == null ? "—" : n > 999 ? "999+ d" : `${fmtFixed(n, 1)} d`)} />}
      sub={
        <>
          <span className="num">{fmtGB(k.diskFreeBytes, 0)}</span> free of <span className="num">{fmtGB(k.diskTotalBytes, 0)}</span> · chain{" "}
          <span className="num">{fmtGB(k.chainDataBytes)}</span>
        </>
      }
    />,
    <Tile
      key="cpu"
      to="/resources"
      label="CPU"
      icon={<Cpu />}
      tone={cpuTone}
      toneText="high"
      value={<AnimatedNumber value={k.cpuPct} format={(n) => fmtPct(n)} />}
      sub="host, 8 vCPU"
    />,
    <Tile
      key="mem"
      to="/resources"
      label="Memory"
      icon={<MemoryStick />}
      tone={memTone}
      toneText="high"
      value={<AnimatedNumber value={k.memUsedBytes} format={(n) => fmtGB(n)} />}
      sub={
        <>
          of <span className="num">{fmtGB(k.memTotalBytes, 0)}</span> · <span className="num">{fmtPct(memPct, 0)}</span>
        </>
      }
    />,
    <Tile
      key="rpm"
      to="/rpc"
      label="Requests / min"
      icon={<Activity />}
      value={<AnimatedNumber value={k.rpcRequestsPerMin} format={(n) => fmtNum(n)} />}
      sub="via the proxy"
    />,
    <Tile
      key="prov"
      to="/pool"
      label="Provider balance"
      icon={<Coins />}
      value={<AnimatedNumber value={k.providerBalanceGlm} format={(n) => (n == null ? "—" : `${fmtFixed(n, 3)}`)} />}
      sub="tGLM, receives payouts"
    />,
    <Tile
      key="hb"
      label="Heartbeat key"
      icon={<Fuel />}
      tone={gasTone}
      toneText="low gas"
      value={<AnimatedNumber value={k.heartbeatBalanceGlm} format={(n) => (n == null ? "—" : `${fmtFixed(n, 3)}`)} />}
      sub="tGLM for heartbeats"
    />,
  ];

  return (
    <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4" aria-label="Key indicators">
      {tiles.map((t, i) => (
        <motion.li
          key={i}
          initial={stagger && motionOk ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.standard, ease: EASE_OUT, delay: stagger ? i * 0.04 : 0 }}
        >
          {t}
        </motion.li>
      ))}
    </ul>
  );
}

function ContainerCard({ c }: { c: ContainerState }) {
  const now = useNow(60_000);
  const tone: Tone = !c.running ? "crit" : c.oomKilled || c.health === "unhealthy" ? "crit" : c.health === "starting" || c.restarts > 3 ? "warn" : "ok";
  const state = !c.running ? "Stopped" : c.health === "none" ? "Running" : c.health[0]!.toUpperCase() + c.health.slice(1);
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-bg/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold capitalize">
            <Box className="size-4 text-muted" aria-hidden />
            {c.service}
          </p>
          <p className="num truncate text-xs text-muted" title={c.image}>
            {c.image}
          </p>
        </div>
        <StatusBadge tone={tone}>{state}</StatusBadge>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted">CPU</dt>
          <dd className="num text-fg">{fmtPct(c.cpuPct)}</dd>
        </div>
        <div>
          <dt className="text-muted">Memory</dt>
          <dd className="num text-fg">{c.memBytes != null && c.memBytes < 1e9 ? `${fmtNum(c.memBytes / 1e6)} MB` : fmtGB(c.memBytes)}</dd>
        </div>
        <div>
          <dt className="text-muted">Up</dt>
          <dd className="num text-fg">{c.running && c.startedAt ? fmtDuration((now - Date.parse(c.startedAt)) / 1000) : "—"}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <Badge className={c.restarts > 0 ? "border-warn/40 text-fg" : undefined}>
          <span className="num">{c.restarts}</span> restarts
        </Badge>
        {c.oomKilled ? (
          <StatusBadge tone="crit">OOM killed</StatusBadge>
        ) : null}
      </div>
      {c.lastErrorLine ? (
        <p className="num rounded-md border border-crit/30 bg-crit/8 px-2 py-1.5 text-xs break-all text-[#fecaca]">{c.lastErrorLine}</p>
      ) : null}
    </li>
  );
}

function HeartbeatCard({ hb, headBlock, updatedAt }: { hb: HeartbeatState; headBlock: number | null; updatedAt: number }) {
  const now = useNow(1000);
  const left =
    hb.expiresAtBlock != null && headBlock != null
      ? Math.max(0, (hb.expiresAtBlock - headBlock) * 2 - (now - updatedAt) / 1000)
      : null;
  return (
    <Card>
      <CardHeader title="Heartbeat on Arkiv" icon={<HeartPulse />} description="Renewed every 30 s." />
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <ExpiryRing
            secondsLeft={hb.enabled ? left : null}
            total={120}
            size={52}
            label={left != null ? `Heartbeat entity expires in ${Math.round(left)} seconds` : "Heartbeat expiry unknown"}
          />
          <div className="min-w-0">
            <HeartbeatIndicator />
            <p className="mt-1 text-xs text-muted">
              {hb.enabled ? (
                <>
                  Expires at block <span className="num">{fmtNum(hb.expiresAtBlock)}</span>
                </>
              ) : (
                hb.reason ?? "Heartbeats are disabled."
              )}
            </p>
          </div>
        </div>
        {hb.failuresInRow > 0 ? (
          <StatusBadge tone={hb.failuresInRow >= 3 ? "crit" : "warn"}>
            {hb.failuresInRow} failed writes in a row{hb.reason ? `: ${hb.reason}` : ""}
          </StatusBadge>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm">
          <dt className="text-xs text-muted">Writer</dt>
          <dd className="min-w-0">
            <Hex value={hb.writer} href={hb.writer ? explorerAddress(hb.writer) : null} />
          </dd>
          <dt className="text-xs text-muted">Entity</dt>
          <dd className="min-w-0">
            <Hex value={hb.entityKey} href={hb.entityKey ? explorerEntity(hb.entityKey) : null} />
          </dd>
          <dt className="text-xs text-muted">Last tx</dt>
          <dd className="min-w-0">
            <Hex value={hb.lastTxHash} href={hb.lastTxHash ? explorerTx(hb.lastTxHash) : null} />
          </dd>
          <dt className="text-xs text-muted">Last block</dt>
          <dd className="num text-sm">
            {fmtNum(hb.lastBlock)} <span className="text-xs text-muted">({fmtAgo(hb.lastAt, now)})</span>
          </dd>
        </dl>
      </CardBody>
    </Card>
  );
}

function RecentAlerts({ alerts }: { alerts: AlertEvent[] }) {
  const now = useNow(30_000);
  return (
    <Card>
      <CardHeader
        title="Recent alerts"
        actions={
          <Link to="/alerts" className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-[#93c5fd] hover:underline lg:min-h-8">
            All alerts <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      />
      <CardBody>
        {alerts.length === 0 ? (
          <EmptyState title="No alerts">Nothing has fired recently.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-2.5">
                <ToneIcon tone={a.status === "resolved" ? "ok" : severityTone(a.severity)} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                    <span className="num">{a.rule}</span>
                    <span className="text-xs font-normal text-muted">
                      {a.status === "resolved" ? "resolved" : `firing · ${a.severity}`}
                    </span>
                  </p>
                  <p className="text-sm text-muted">{a.summary}</p>
                </div>
                <time className="num shrink-0 text-xs text-muted" dateTime={new Date(a.startedAt).toISOString()} title={fmtDateTime(a.startedAt)}>
                  {fmtAgo(a.startedAt, now)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading overview" className="flex flex-col gap-4">
      <Skeleton className="h-44" />
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    </div>
  );
}

function Body({ data, stagger }: { data: OverviewT; stagger: boolean }) {
  const motionOk = useMotionOk();
  const section = (i: number) => ({
    initial: stagger && motionOk ? { opacity: 0, y: 8 } : false,
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.standard, ease: EASE_OUT, delay: stagger ? 0.32 + i * 0.04 : 0 },
  });
  return (
    <div className="flex flex-col gap-4">
      <VerdictHero verdict={data.verdict} />
      <KpiGrid k={data.kpis} stagger={stagger} />
      <div className="grid gap-4 xl:grid-cols-3">
        <motion.div {...section(0)} className="min-w-0 xl:col-span-2">
          <Card>
            <CardHeader title="Node containers" icon={<Box />} description="Node kit stack, read-only." />
            <CardBody>
              <ul className="grid gap-3 md:grid-cols-3">
                {data.containers.map((c) => (
                  <ContainerCard key={c.service} c={c} />
                ))}
              </ul>
            </CardBody>
          </Card>
        </motion.div>
        <motion.div {...section(1)} className="min-w-0">
          <HeartbeatCard hb={data.heartbeat} headBlock={data.kpis.referenceHead ?? data.kpis.headBlock} updatedAt={data.updatedAt} />
        </motion.div>
      </div>
      <motion.div {...section(2)}>
        <RecentAlerts alerts={data.recentAlerts} />
      </motion.div>
    </div>
  );
}

export default function Overview() {
  const q = useOverview();
  const stagger = isFirstLoad("overview");
  const n = q.data?.node;
  return (
    <>
      <PageHeader
        title="Overview"
        description={
          n ? (
            <>
              {n.instanceName ?? "Arkiv node"} · {n.network} (chain <span className="num">{n.chainId ?? "—"}</span>) ·{" "}
              <span className="num text-xs">{n.elVersion?.split("/").slice(0, 2).join("/") ?? "EL —"}</span> ·{" "}
              <span className="num text-xs">{n.clVersion?.split("/").slice(0, 2).join("/") ?? "CL —"}</span>
              {n.providerAddress ? (
                <>
                  {" "}
                  · provider <Hex value={n.providerAddress} href={explorerAddress(n.providerAddress)} />
                </>
              ) : null}
            </>
          ) : (
            "Node status and the fix."
          )
        }
      />
      {q.isLoading ? (
        <OverviewSkeleton />
      ) : q.error || !q.data ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : (
        <Body data={q.data} stagger={stagger} />
      )}
    </>
  );
}
