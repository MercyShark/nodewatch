import { useState } from "react";
import { CloudUpload, HardDrive, History, Play, RotateCcw, ShieldCheck, Undo2 } from "lucide-react";
import type { BackupItem, BackupsResponse } from "@nodewatch/shared";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyButton, Hex } from "@/components/ui/copy";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, InlineError, LoadingBlock } from "@/components/ui/feedback";
import { StatusBadge, ToneIcon } from "@/components/ui/status";
import { DataTable, type Column } from "@/components/ui/table";
import { useIsAdmin } from "@/lib/auth";
import { errorMessage, isForbidden } from "@/lib/api";
import { useBackups, useRunBackup, useTestRestore } from "@/lib/queries";
import { fmtAgo, fmtBytes, fmtDateTime } from "@/lib/format";
import { pushToast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { AdminOnlyPanel, Stagger, StaggerItem } from "./admin-shared";

const STALE_MS = 26 * 3600_000; // BackupFailed fires when the newest backup is older than 26 h.

type TargetName = BackupsResponse["targets"][number]["name"];
const TARGET_INFO: Record<TargetName, { label: string; where: string; icon: typeof HardDrive }> = {
  local: { label: "Local disk", where: "/srv/nodewatch/backups (copy it off the box)", icon: HardDrive },
  swarm: { label: "Swarm", where: "Encrypted envelope via the vault's Bee node", icon: CloudUpload },
};
const KIND_LABEL: Record<BackupItem["kind"], string> = { "keys-config": "Keys + config", "nodewatch-db": "Nodewatch DB" };

const GUIDE: { title: string; cmd?: string; note?: string }[] = [
  {
    title: "Fetch the newest encrypted file",
    note: "Local: copy it from /srv/nodewatch/backups. Swarm: download the bzz reference shown in the table.",
  },
  {
    title: "Decrypt it with the operator's key",
    cmd: "pnpm tsx scripts/decrypt-bundle.ts --key <operator key> <file>",
  },
  { title: "Verify the checksum matches the SHA-256 in the table", cmd: "sha256sum <decrypted file>" },
  {
    title: "Restore the keystore, .env and frpc.toml",
    cmd: "sudo cp -a keystore .env frpc.toml /opt/arkiv-community-node/",
    note: "The keystore is still password-protected after decryption.",
  },
  { title: "Restart the node kit", cmd: "cd /opt/arkiv-community-node && ./setup.sh" },
];

function TestRestoreResult({ result, error }: { result: { ok: boolean; message?: string } | undefined; error: unknown }) {
  if (!result && !error) return null;
  const ok = !!result?.ok && !error;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-sm text-fg",
        ok ? "border-ok/35 bg-ok/10" : "border-crit/40 bg-crit/10",
      )}
    >
      <ToneIcon tone={ok ? "ok" : "crit"} className="mt-0.5" />
      <span>
        <span className="font-semibold">{ok ? "Test restore passed. " : "Test restore failed. "}</span>
        {error ? errorMessage(error) : (result?.message ?? "")}
      </span>
    </p>
  );
}

export default function Backups() {
  const admin = useIsAdmin();
  const backups = useBackups(admin);
  const run = useRunBackup();
  const restore = useTestRestore();
  const [confirm, setConfirm] = useState(false);
  const now = Date.now();

  const header = (
    <PageHeader
      title="Backups"
      description="Provider keystore, node .env and frpc.toml, plus the Nodewatch database, envelope-encrypted to the operator's wallet key before they leave the process."
      actions={
        admin && backups.data ? (
          <>
            <Button onClick={() => restore.mutate(null)} loading={restore.isPending && restore.variables === null}>
              <RotateCcw className="size-4" aria-hidden /> Test restore latest
            </Button>
            <Button variant="primary" onClick={() => setConfirm(true)} loading={run.isPending}>
              <Play className="size-4" aria-hidden /> Run now
            </Button>
          </>
        ) : null
      }
    />
  );

  if (!admin || (backups.error && isForbidden(backups.error))) {
    return (
      <>
        {header}
        <AdminOnlyPanel what="Backups contain encrypted node keys and configuration." />
      </>
    );
  }

  const data = backups.data;
  const lastFor = (t: TargetName) => {
    const items = (data?.items ?? []).filter((i) => i.target === t).sort((a, b) => b.createdAt - a.createdAt);
    return { lastOk: items.find((i) => i.ok)?.createdAt ?? null, latest: items[0] ?? null };
  };
  const stale = data ? data.lastSuccessAt == null || now - data.lastSuccessAt > STALE_MS : false;

  const testBtn = (b: BackupItem) =>
    b.ok ? (
      <Button size="sm" onClick={() => restore.mutate(b.id)} loading={restore.isPending && restore.variables === b.id} aria-label={`Test restore ${b.id}`}>
        <RotateCcw className="size-4" aria-hidden /> Test
      </Button>
    ) : null;

  const columns: Column<BackupItem>[] = [
    {
      key: "target",
      header: "Target",
      cell: (b) => <span className="text-sm text-fg">{TARGET_INFO[b.target].label}</span>,
      sort: (b) => b.target,
    },
    { key: "kind", header: "Kind", cell: (b) => <span className="text-sm">{KIND_LABEL[b.kind]}</span>, sort: (b) => b.kind },
    {
      key: "location",
      header: "Location",
      hideBelow: "lg",
      cell: (b) =>
        b.location ? (
          <span className="flex min-w-0 items-center">
            <code className="num block max-w-[22rem] truncate text-xs text-muted" title={b.location}>
              {b.location}
            </code>
            <CopyButton text={b.location} label="Copy location" />
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: "size", header: "Size", align: "right", cell: (b) => (b.ok ? fmtBytes(b.sizeBytes) : "—"), sort: (b) => b.sizeBytes },
    { key: "sha", header: "SHA-256", hideBelow: "lg", cell: (b) => <Hex value={b.sha256} head={8} tail={6} /> },
    {
      key: "status",
      header: "Status",
      cell: (b) =>
        b.ok ? (
          <StatusBadge tone="ok">OK</StatusBadge>
        ) : (
          <span className="flex flex-col items-start gap-1">
            <StatusBadge tone="crit">Failed</StatusBadge>
            {b.error ? <span className="max-w-xs text-xs text-[#fca5a5]">{b.error}</span> : null}
          </span>
        ),
      sort: (b) => (b.ok ? 1 : 0),
    },
    {
      key: "created",
      header: "Created",
      align: "right",
      cell: (b) => <span title={fmtDateTime(b.createdAt)}>{fmtAgo(b.createdAt, now)}</span>,
      sort: (b) => b.createdAt,
    },
    { key: "action", header: <span className="sr-only">Actions</span>, align: "right", cell: testBtn },
  ];

  return (
    <>
      {header}
      {backups.isLoading ? (
        <LoadingBlock className="h-72" label="Loading backups" />
      ) : backups.error || !data ? (
        <Card>
          <ErrorState error={backups.error} onRetry={() => void backups.refetch()} />
        </Card>
      ) : (
        <Stagger page="backups" className="flex flex-col gap-4">
          <InlineError error={run.error} />
          <TestRestoreResult result={restore.data} error={restore.error} />

          <StaggerItem>
            <Card>
              <CardHeader
                title="Targets"
                icon={<ShieldCheck />}
                description={
                  <>
                    Last success:{" "}
                    <span className="num text-fg">{data.lastSuccessAt ? `${fmtAgo(data.lastSuccessAt, now)} (${fmtDateTime(data.lastSuccessAt)})` : "never"}</span>
                  </>
                }
                actions={
                  stale ? <StatusBadge tone="warn">Older than 26 h</StatusBadge> : <StatusBadge tone="ok">Up to date</StatusBadge>
                }
              />
              <CardBody>
                <ul className="grid gap-3 sm:grid-cols-3">
                  {data.targets.map((t) => {
                    const info = TARGET_INFO[t.name];
                    const { lastOk, latest } = lastFor(t.name);
                    return (
                      <li key={t.name} className="flex flex-col gap-2 rounded-lg border border-border bg-bg/60 p-3">
                        <div className="flex items-center gap-2">
                          <info.icon className="size-4 text-muted" aria-hidden />
                          <span className="text-sm font-semibold text-fg">{info.label}</span>
                          <span className="ml-auto">
                            {t.configured ? <StatusBadge tone="ok">Configured</StatusBadge> : <StatusBadge tone="neutral">Off</StatusBadge>}
                          </span>
                        </div>
                        <p className="text-xs text-muted">{info.where}</p>
                        {t.configured ? (
                          <p className="text-xs text-muted">
                            Last success: <span className="num text-fg">{lastOk ? fmtAgo(lastOk, now) : "never"}</span>
                            {latest && !latest.ok ? <span className="block text-[#fca5a5]">Latest attempt failed</span> : null}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card>
              <CardHeader title="History" icon={<History />} description="Newest first. Test restore decrypts to a temp dir and verifies the checksum." />
              <CardBody>
                {data.items.length === 0 ? (
                  <EmptyState title="No backups yet" action={<Button onClick={() => setConfirm(true)}>Run the first backup</Button>}>
                    Backups run nightly and on demand.
                  </EmptyState>
                ) : (
                  <>
                    <ul className="flex flex-col divide-y divide-border md:hidden">
                      {data.items.map((b) => (
                        <li key={b.id} className="flex flex-col gap-1.5 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-fg">{TARGET_INFO[b.target].label}</span>
                            <span className="text-sm text-muted">· {KIND_LABEL[b.kind]}</span>
                            <span className="ml-auto">{b.ok ? <StatusBadge tone="ok">OK</StatusBadge> : <StatusBadge tone="crit">Failed</StatusBadge>}</span>
                          </div>
                          {b.error ? <p className="text-xs text-[#fca5a5]">{b.error}</p> : null}
                          {b.location ? (
                            <code className="num block truncate text-xs text-muted" title={b.location}>
                              {b.location}
                            </code>
                          ) : null}
                          <div className="flex items-center justify-between gap-2 text-xs text-muted">
                            <span className="num">
                              {b.ok ? fmtBytes(b.sizeBytes) : "—"} · {fmtAgo(b.createdAt, now)}
                            </span>
                            {testBtn(b)}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="hidden md:block">
                      <DataTable
                        rows={data.items}
                        columns={columns}
                        rowKey={(b) => b.id}
                        caption="Backup history"
                        initialSort={{ key: "created", dir: "desc" }}
                      />
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card>
              <CardHeader title="Restore guide" icon={<Undo2 />} description="From an encrypted backup to a running node." />
              <CardBody className="flex flex-col gap-4">
                <ol className="flex flex-col gap-3">
                  {GUIDE.map((s, i) => (
                    <li key={s.title} className="flex gap-3">
                      <span className="num inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs text-fg" aria-hidden>
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-fg">{s.title}</p>
                        {s.note ? <p className="text-xs text-muted">{s.note}</p> : null}
                        {s.cmd ? (
                          <div className="mt-1 flex items-center gap-1 rounded-md border border-border bg-bg pl-3">
                            <code className="num min-w-0 flex-1 overflow-x-auto py-2 text-xs whitespace-nowrap text-fg">{s.cmd}</code>
                            <CopyButton text={s.cmd} label={`Copy command: ${s.cmd}`} />
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="flex items-start gap-2 rounded-lg border border-border bg-bg/60 p-3 text-sm text-muted">
                  <ToneIcon tone="info" className="mt-0.5" />
                  <span>
                    Chain data is not backed up. It is reproducible with <code className="num text-fg">./setup.sh</code> (Arkiv snapshot
                    restore + sync).
                  </span>
                </p>
              </CardBody>
            </Card>
          </StaggerItem>
        </Stagger>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        loading={run.isPending}
        title="Run a backup now?"
        confirmLabel="Run backup"
        description="Encrypts the provider keystore, node .env, frpc.toml and a Nodewatch database snapshot to the operator's wallet key, then writes them to every configured target."
        onConfirm={() =>
          run.mutate(undefined, {
            onSuccess: () => {
              setConfirm(false);
              pushToast({ tone: "ok", title: "Backup finished", body: "New items are listed in the history." });
            },
            onError: () => setConfirm(false),
          })
        }
      />
    </>
  );
}
