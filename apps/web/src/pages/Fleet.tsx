import type { ReactNode } from "react";
import { Info, Network, ShieldAlert, ShieldCheck } from "lucide-react";
import type { FleetNode } from "@nodewatch/shared";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Hex } from "@/components/ui/copy";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Badge, StatusBadge, ToneIcon, severityTone, type Tone } from "@/components/ui/status";
import { ExpiryRing, useCountdown } from "@/components/ui/time";
import { StaggerItem, useFirstLoad } from "@/components/ui/stagger-item";
import { explorerAddress, explorerEntity } from "@/lib/config";
import { DASH, fmtBlocksAsTime, fmtDuration, fmtFixed, fmtNum } from "@/lib/format";
import { useFleet } from "@/lib/queries";
import { cn } from "@/lib/cn";

const HEARTBEAT_TTL_SEC = 120; // 60 blocks x 2 s
const STATUS_ORDER: Record<FleetNode["status"], number> = { down: 0, degraded: 1, ok: 2 };
const STATUS_LABEL: Record<FleetNode["status"], string> = { ok: "OK", degraded: "Degraded", down: "Down" };

function Metric({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-0.5 truncate text-sm text-fg">{children}</dd>
    </div>
  );
}

function diskTone(d: number | null): Tone {
  if (d == null) return "neutral";
  if (d < 2) return "crit";
  if (d < 7) return "warn";
  return "ok";
}

function NodeCard({ node, fetchedAt }: { node: FleetNode; fetchedAt: number }) {
  const left = useCountdown(node.expiresInSec, fetchedAt);
  const tone = severityTone(node.status);
  const lagTone: Tone = node.headLag == null ? "neutral" : node.headLag > 10 ? "warn" : "ok";
  const dTone = diskTone(node.diskDaysLeft);
  return (
    <Card className={cn("h-full", node.isSelf && "border-primary shadow-[0_0_0_1px_var(--primary)]")}>
      <div className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <ExpiryRing
          secondsLeft={left}
          total={HEARTBEAT_TTL_SEC}
          size={48}
          label={left == null ? "Heartbeat expiry unknown" : left <= 0 ? "Heartbeat expired" : `Heartbeat expires in ${fmtDuration(left)}`}
        />
        <div className="min-w-0 flex-1">
          <h2 className="flex min-w-0 items-center gap-1 text-sm font-semibold text-fg">
            <span className="sr-only">Provider </span>
            <Hex value={node.provider} href={explorerAddress(node.provider)} />
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={tone}>{STATUS_LABEL[node.status]}</StatusBadge>
            {node.isSelf ? <Badge className="border-primary/50 text-fg">This node</Badge> : null}
            {node.trusted ? (
              <Badge title="Creator is pinned or on the allowlist">
                <ShieldCheck className="size-3.5 text-ok" aria-hidden /> Trusted
              </Badge>
            ) : (
              <Badge title="Creator is not on your allowlist; shown but not trusted">
                <ShieldAlert className="size-3.5 text-warn" aria-hidden /> Untrusted
              </Badge>
            )}
          </div>
        </div>
      </div>
      <CardBody>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Metric label="Verdict">{String(node.verdict).replace(/_/g, " ")}</Metric>
          <Metric label="Head lag">
            <span className="inline-flex items-center gap-1">
              <ToneIcon tone={lagTone} className="size-3.5" />
              {node.headLag == null ? DASH : `${fmtNum(node.headLag)} blk`}
            </span>
            {node.headLag ? <span className="block text-xs text-muted">≈ {fmtBlocksAsTime(node.headLag)}</span> : null}
          </Metric>
          <Metric label="Disk days left">
            <span className="inline-flex items-center gap-1">
              <ToneIcon tone={dTone} className="size-3.5" />
              {node.diskDaysLeft == null ? DASH : node.diskDaysLeft > 365 ? "> 1 year" : `${fmtFixed(node.diskDaysLeft, 1)} d`}
            </span>
          </Metric>
          <Metric label="Peers EL / CL">
            {fmtNum(node.peersEl)} / {fmtNum(node.peersCl)}
          </Metric>
          <Metric label="Expires in">{left == null ? DASH : left <= 0 ? "expired" : fmtDuration(left)}</Metric>
          <Metric label="Expiry block">{fmtNum(node.expiresAtBlock)}</Metric>
          <Metric label="Client" className="col-span-2 sm:col-span-3">
            <span title={node.client ?? undefined}>{node.client ?? DASH}</span>
          </Metric>
          <Metric label="Agent">{node.agentVersion ?? DASH}</Metric>
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-muted">Heartbeat entity</dt>
            <dd className="mt-0.5 min-w-0">
              <Hex value={node.entityKey} href={explorerEntity(node.entityKey)} />
            </dd>
          </div>
          <div className="col-span-2 min-w-0 sm:col-span-3">
            <dt className="text-xs text-muted">Creator (heartbeat key)</dt>
            <dd className="mt-0.5 min-w-0">
              <Hex value={node.creator} href={explorerAddress(node.creator)} />
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}

export default function FleetPage() {
  const q = useFleet();
  const first = useFirstLoad("fleet");
  const nodes = [...(q.data?.nodes ?? [])].sort(
    (a, b) => Number(b.isSelf) - Number(a.isSelf) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || Number(b.trusted) - Number(a.trusted),
  );
  const counts = { ok: 0, degraded: 0, down: 0 };
  for (const n of nodes) counts[n.status]++;

  return (
    <>
      <PageHeader
        title="Fleet"
        description="Every node that publishes Nodewatch heartbeats on Arkiv, read from live nodewatch.heartbeat entities."
        actions={q.data?.currentBlock != null ? <Badge>block <span className="num">{fmtNum(q.data.currentBlock)}</span></Badge> : null}
      />
      {q.isLoading ? (
        <div role="status" aria-label="Loading fleet" className="flex flex-col gap-4">
          <Skeleton className="h-20" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      ) : q.error && !q.data ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <StaggerItem index={0} first={first}>
            <div className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,2fr)]">
              {(["ok", "degraded", "down"] as const).map((s) => (
                <div key={s} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
                  <ToneIcon tone={severityTone(s)} className="size-5" />
                  <div>
                    <p className="num text-xl font-semibold text-fg">{counts[s]}</p>
                    <p className="text-xs text-muted">{STATUS_LABEL[s]}</p>
                  </div>
                </div>
              ))}
              <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <p>
                  Heartbeat entities expire after <span className="num text-fg">60</span> blocks (about 2 minutes) and each node renews its own
                  every 30 s. Arkiv fires no event on expiry, so <strong className="text-fg">absence means down</strong>: a node that stops
                  renewing simply disappears from this list.
                </p>
              </div>
            </div>
          </StaggerItem>
          {nodes.length === 0 ? (
            <Card>
              <CardHeader icon={<Network />} title="Nodes" />
              <EmptyState title="No live heartbeats">
                No nodewatch.heartbeat entities are alive right now, including this node's. Check that HEARTBEAT_PRIVATE_KEY is set and
                funded with tGLM.
              </EmptyState>
            </Card>
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2" aria-label="Nodes">
              {nodes.map((n, i) => (
                <li key={n.entityKey} className="min-w-0">
                  <StaggerItem index={i + 1} first={first} className="h-full">
                    <NodeCard node={n} fetchedAt={q.dataUpdatedAt} />
                  </StaggerItem>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
