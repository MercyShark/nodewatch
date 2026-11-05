import type { ReactNode } from "react";
import { Coins, FileCheck2, Handshake, ReceiptText, Store, Tag, Wallet } from "lucide-react";
import type { PoolResponse } from "@nodewatch/shared";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton, Hex } from "@/components/ui/copy";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Badge, StatusBadge, ToneIcon, type Tone } from "@/components/ui/status";
import { DataTable, type Column } from "@/components/ui/table";
import { useCountdown } from "@/components/ui/time";
import { StaggerItem, useFirstLoad } from "@/components/ui/stagger-item";
import { explorerAddress, explorerEntity, explorerTx } from "@/lib/config";
import { DASH, fmtBlocksAsTime, fmtDuration, fmtGlm, fmtNum, weiToGlm } from "@/lib/format";
import { usePool } from "@/lib/queries";
import { useIsAdmin } from "@/lib/auth";
import { AutopilotCard } from "@/components/AutopilotCard";
import { cn } from "@/lib/cn";

type Receipt = PoolResponse["receipts"][number];

/** Amount in wei from a receipt payload (amount_wei | wei | amount). Format is not fixed yet. */
function receiptWei(p: Record<string, unknown>): bigint | null {
  for (const k of ["amount_wei", "wei", "amount"]) {
    const v = p[k];
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
    if (typeof v === "number" && Number.isFinite(v)) {
      // Integers that large are wei; small/decimal numbers are taken as GLM.
      if (Number.isInteger(v) && v > 1e9) return BigInt(v);
      return BigInt(Math.round(v * 1e6)) * 10n ** 12n;
    }
  }
  return null;
}
const receiptCount = (p: Record<string, unknown>): number | null =>
  typeof p.count === "number" ? p.count : typeof p.count === "string" && /^\d+$/.test(p.count) ? Number(p.count) : null;
const receiptTx = (p: Record<string, unknown>): string | null =>
  typeof p.tx === "string" ? p.tx : typeof p.txHash === "string" ? p.txHash : null;

function blocksAgo(current: number | null, block: number | null | undefined): string {
  if (current == null || block == null) return DASH;
  return `${fmtBlocksAsTime(Math.max(0, current - block))} ago`;
}

function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm text-fg">{children}</dd>
    </div>
  );
}

function ExpiryBar({ left, total, label }: { left: number | null; total: number; label: string }) {
  const frac = left == null || total <= 0 ? 0 : Math.max(0, Math.min(1, left / total));
  const tone: Tone = left == null ? "neutral" : left <= 0 ? "crit" : left < 15 * 60 ? "warn" : "ok";
  const color = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", neutral: "var(--fg-muted)", info: "var(--primary)" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(frac * 100)}
      aria-valuetext={left == null ? "unknown" : left <= 0 ? "expired" : `${fmtDuration(left)} left`}
      className="h-2 w-full overflow-hidden rounded-full bg-bg"
    >
      <div
        className="h-full origin-left rounded-full transition-transform duration-1000 ease-linear"
        style={{ background: color, transform: `scaleX(${frac})` }}
      />
    </div>
  );
}

function Explainer({ data }: { data: PoolResponse }) {
  const wei = data.agreement?.weiPerCall ?? data.listing?.weiPerCall ?? null;
  const count = data.counter?.count ?? null;
  const accruedWei = count != null && wei ? BigInt(count) * BigInt(wei) : null;
  const paidWei = data.receipts.reduce<bigint | null>((sum, r) => {
    const w = receiptWei(r.payload);
    return w == null ? sum : (sum ?? 0n) + w;
  }, null);
  const pendingWei = accruedWei != null ? accruedWei - (paidWei ?? 0n) : null;

  const steps: { icon: ReactNode; title: string; value: ReactNode; sub: ReactNode }[] = [
    {
      icon: <FileCheck2 aria-hidden />,
      title: "Counted on-chain",
      value: <span className="num">{fmtNum(count)} req</span>,
      sub: <span className="num">accrued {fmtGlm(weiToGlm(accruedWei), 4)}</span>,
    },
    {
      icon: <Wallet aria-hidden />,
      title: "Paid",
      value: <span className="num">{fmtGlm(weiToGlm(paidWei), 4)}</span>,
      sub: (
        <span className="num">
          {data.receipts.length} receipt{data.receipts.length === 1 ? "" : "s"}
          {pendingWei != null && pendingWei > 0n ? ` · pending ${fmtGlm(weiToGlm(pendingWei), 4)}` : ""}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        icon={<Coins />}
        title="Earnings"
        description="The LB counts requests about once a day. GLM arrives with a payout receipt, so paid lags counted."
      />
      <CardBody>
        <dl className="grid gap-3 sm:grid-cols-2">
          {steps.map((s) => (
            <div key={s.title} className="flex flex-col gap-1 rounded-lg border border-border bg-bg/50 p-4">
              <dt className="flex items-center gap-2 text-sm font-medium text-muted">
                <span className="text-primary [&>svg]:size-4">{s.icon}</span>
                {s.title}
              </dt>
              <dd className="text-xl font-semibold text-fg">{s.value}</dd>
              <dd className="text-xs text-muted">{s.sub}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

function AgreementCard({ data, fetchedAt }: { data: PoolResponse; fetchedAt: number }) {
  const a = data.agreement;
  const left = useCountdown(a?.expiresInSec, fetchedAt);
  if (!a) {
    const cmd = "./marketplace.sh post-offer";
    return (
      <Card className="h-full border-warn/40">
        <CardHeader icon={<Handshake />} title="Agreement" actions={<StatusBadge tone="warn">No live agreement</StatusBadge>} />
        <CardBody className="flex flex-col gap-3">
          <p className="text-sm text-muted">No agreement, so the pool sends no traffic. Post an offer.</p>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg pl-3">
            <code className="num min-w-0 flex-1 truncate text-sm text-fg">{cmd}</code>
            <CopyButton text={cmd} label="Copy command" />
          </div>
        </CardBody>
      </Card>
    );
  }
  const totalSec = Math.max(1, (a.expiresAtBlock - a.updatedAtBlock) * 2);
  const tone: Tone = left == null ? "neutral" : left <= 0 ? "crit" : left < 15 * 60 ? "warn" : "ok";
  return (
    <Card className="h-full">
      <CardHeader
        icon={<Handshake />}
        title="Agreement"
        actions={<StatusBadge tone={tone}>{tone === "crit" ? "Expired" : tone === "warn" ? "Expiring soon" : "Live"}</StatusBadge>}
      />
      <CardBody className="flex flex-col gap-4">
        <div>
          <p className="text-xs text-muted">Expires in</p>
          <p className="num text-2xl font-semibold text-fg" aria-live="off">
            {left == null ? DASH : left <= 0 ? "expired" : fmtDuration(left)}
          </p>
          <div className="mt-2">
            <ExpiryBar left={left} total={totalSec} label="Time until the agreement expires" />
          </div>
          <p className="mt-1 text-xs text-muted">
            at block <span className="num">{fmtNum(a.expiresAtBlock)}</span> · refreshed {blocksAgo(data.currentBlock, a.updatedAtBlock)}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Remote port">
            <span className="num">{a.remotePort}</span>
          </Stat>
          <Stat label="Price per call">
            <span className="num">{fmtGlm(weiToGlm(a.weiPerCall), 6)}</span>
          </Stat>
          <Stat label="Entity key" className="col-span-2">
            <Hex value={a.key} href={explorerEntity(a.key)} />
          </Stat>
        </dl>
      </CardBody>
    </Card>
  );
}

function OfferCard({ data, fetchedAt }: { data: PoolResponse; fetchedAt: number }) {
  const o = data.offer;
  const left = useCountdown(o?.expiresInSec, fetchedAt);
  return (
    <Card className="h-full">
      <CardHeader
        icon={<Tag />}
        title="Offer"
        description="rpc.offer"
        actions={
          o ? (
            <StatusBadge tone={left != null && left <= 0 ? "crit" : "ok"}>{left != null && left <= 0 ? "Expired" : "Posted"}</StatusBadge>
          ) : (
            <StatusBadge tone="warn">None</StatusBadge>
          )
        }
      />
      <CardBody>
        {o ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat label="Expires in">
              <span className="num">{left == null ? DASH : left <= 0 ? "expired" : fmtDuration(left)}</span>
            </Stat>
            <Stat label="Expiry block">
              <span className="num">{fmtNum(o.expiresAtBlock)}</span>
            </Stat>
            <Stat label="Entity key" className="col-span-2">
              <Hex value={o.key} href={explorerEntity(o.key)} />
            </Stat>
          </dl>
        ) : (
          <p className="text-sm text-muted">No live offer. Run <code className="num text-fg">./marketplace.sh post-offer</code>.</p>
        )}
      </CardBody>
    </Card>
  );
}

function ListingCard({ data }: { data: PoolResponse }) {
  const l = data.listing;
  return (
    <Card className="h-full">
      <CardHeader icon={<Store />} title="LB listing" description="rpc.lb_listing" />
      <CardBody>
        {l ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat label="Price per call">
              <span className="num">{fmtGlm(weiToGlm(l.weiPerCall), 6)}</span>
            </Stat>
            <Stat label="Max providers">
              <span className="num">{fmtNum(l.maxProviders)}</span>
            </Stat>
            <Stat label="Tunnel server" className="col-span-2">
              <span className="num break-all">{l.tunnelServer}</span>
            </Stat>
            <Stat label="Entity key" className="col-span-2">
              <Hex value={l.key} href={explorerEntity(l.key)} />
            </Stat>
          </dl>
        ) : (
          <p className="text-sm text-muted">Listing not found yet.</p>
        )}
      </CardBody>
    </Card>
  );
}

function CounterCard({ data }: { data: PoolResponse }) {
  const c = data.counter;
  return (
    <Card className="h-full">
      <CardHeader
        icon={<FileCheck2 />}
        title="Request counter"
        description="rpc.counter, updated about daily"
        actions={c ? <StatusBadge tone={c.state === "open" ? "ok" : "neutral"}>{c.state}</StatusBadge> : null}
      />
      <CardBody>
        {c ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat label="Requests counted">
              <span className="num text-xl font-semibold">{fmtNum(c.count)}</span>
            </Stat>
            <Stat label="Last written">
              <span className="num">{blocksAgo(data.currentBlock, c.updatedAtBlock)}</span>
            </Stat>
            <Stat label="Opened at block">
              <span className="num">{fmtNum(c.openedBlock)}</span>
            </Stat>
            <Stat label="Updated at block">
              <span className="num">{fmtNum(c.updatedAtBlock)}</span>
            </Stat>
            <Stat label="Entity key" className="col-span-2">
              <Hex value={c.key} href={explorerEntity(c.key)} />
            </Stat>
          </dl>
        ) : (
          <p className="text-sm text-muted">No counter yet.</p>
        )}
      </CardBody>
    </Card>
  );
}

function BalanceCard({ data }: { data: PoolResponse }) {
  return (
    <Card className="h-full">
      <CardHeader icon={<Wallet />} title="Provider" description="Receives payouts." />
      <CardBody>
        <dl className="grid grid-cols-1 gap-y-3">
          <Stat label="Balance">
            <span className="num text-xl font-semibold">{fmtGlm(data.balanceGlm, 4)}</span>
          </Stat>
          <Stat label="Provider address">
            <Hex value={data.providerAddress} href={data.providerAddress ? explorerAddress(data.providerAddress) : null} />
          </Stat>
          <Stat label="Load balancer">
            <Hex value={data.lbAddress} href={explorerAddress(data.lbAddress)} />
          </Stat>
          <Stat label="Current block">
            <span className="num">{fmtNum(data.currentBlock)}</span>
          </Stat>
        </dl>
      </CardBody>
    </Card>
  );
}

function ReceiptsCard({ data }: { data: PoolResponse }) {
  const columns: Column<Receipt>[] = [
    {
      key: "created",
      header: "Created",
      cell: (r) => (
        <span className="num text-xs">
          {blocksAgo(data.currentBlock, r.createdAtBlock)}
          <span className="block text-muted">#{fmtNum(r.createdAtBlock)}</span>
        </span>
      ),
      sort: (r) => r.createdAtBlock,
    },
    {
      key: "count",
      header: "Requests",
      align: "right",
      cell: (r) => fmtNum(receiptCount(r.payload)),
      sort: (r) => receiptCount(r.payload),
      hideBelow: "sm",
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (r) => fmtGlm(weiToGlm(receiptWei(r.payload)), 4),
      sort: (r) => weiToGlm(receiptWei(r.payload)),
    },
    {
      key: "tx",
      header: "Payout",
      cell: (r) => {
        const tx = receiptTx(r.payload);
        return tx ? <Hex value={tx} href={explorerTx(tx)} copy={false} head={6} tail={4} /> : <span className="text-muted">{DASH}</span>;
      },
    },
    {
      key: "key",
      header: "Entity",
      cell: (r) => <Hex value={r.key} href={explorerEntity(r.key)} copy={false} />,
      hideBelow: "md",
    },
  ];
  return (
    <Card>
      <CardHeader icon={<ReceiptText />} title="Payout receipts" />
      <CardBody>
        <DataTable
          rows={data.receipts}
          columns={columns}
          rowKey={(r) => r.key}
          caption="Payout receipts"
          initialSort={{ key: "created", dir: "desc" }}
          empty={
            <div className="flex items-center gap-2 py-6 text-sm text-muted">
              <ToneIcon tone="neutral" />
              No payouts yet.
            </div>
          }
        />
      </CardBody>
    </Card>
  );
}

export default function PoolPage() {
  const q = usePool();
  const admin = useIsAdmin();
  const first = useFirstLoad("pool");
  const data = q.data;
  return (
    <>
      <PageHeader
        title="Pool & earnings"
        description="Offer, agreement, requests and payouts from Arkiv. Refreshed every 5 minutes."
        actions={data ? <Badge>{fmtGlm(weiToGlm(data.agreement?.weiPerCall ?? data.listing?.weiPerCall ?? null), 6)} / request</Badge> : null}
      />
      {q.isLoading ? (
        <div role="status" aria-label="Loading pool data" className="flex flex-col gap-4">
          <Skeleton className="h-56" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      ) : q.error || !data ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {admin ? (
            <StaggerItem index={0} first={first}>
              <AutopilotCard />
            </StaggerItem>
          ) : null}
          <StaggerItem index={0} first={first}>
            <Explainer data={data} />
          </StaggerItem>
          <div className="grid gap-4 lg:grid-cols-3">
            <StaggerItem index={1} first={first}>
              <AgreementCard data={data} fetchedAt={q.dataUpdatedAt} />
            </StaggerItem>
            <StaggerItem index={2} first={first}>
              <CounterCard data={data} />
            </StaggerItem>
            <StaggerItem index={3} first={first}>
              <BalanceCard data={data} />
            </StaggerItem>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <StaggerItem index={4} first={first}>
              <OfferCard data={data} fetchedAt={q.dataUpdatedAt} />
            </StaggerItem>
            <StaggerItem index={5} first={first}>
              <ListingCard data={data} />
            </StaggerItem>
          </div>
          <StaggerItem index={6} first={first}>
            <ReceiptsCard data={data} />
          </StaggerItem>
        </div>
      )}
    </>
  );
}
