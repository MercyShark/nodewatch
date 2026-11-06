import { useEffect, useState } from "react";
import { ArrowUpCircle, CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { useLiveQueries, useStartUpdate, useUpdateCheck, useUpdateState } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { pushToast } from "@/lib/toast";
import { useIsAdmin } from "@/lib/auth";
import { fmtAgo } from "@/lib/format";
import { useNow } from "@/components/ui/time";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Badge, StatusBadge } from "@/components/ui/status";
import { ErrorState, Skeleton } from "@/components/ui/feedback";

const short = (d: string | null) => (d ? d.replace("sha256:", "").slice(0, 12) : "unknown");

/** Wait for this Nodewatch to go away and come back, then reload into the new version. */
function useReloadWhenBack(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let wentDown = false;
    const started = Date.now();
    const t = setInterval(async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok && (wentDown || Date.now() - started > 150_000)) window.location.reload();
        if (!r.ok) wentDown = true;
      } catch {
        wentDown = true;
      }
    }, 3000);
    return () => clearInterval(t);
  }, [active]);
}

/** Settings → Updates. Nodewatch only checks; it updates when the admin presses the button. */
export function UpdateCard() {
  const admin = useIsAdmin();
  const q = useUpdateState(admin);
  const inline = useLiveQueries("1h", true).data?.mode === "inline";
  const check = useUpdateCheck();
  const start = useStartUpdate();
  const now = useNow(30_000);
  const [confirm, setConfirm] = useState(false);
  const [updating, setUpdating] = useState(false);
  useReloadWhenBack(updating);
  if (!admin) return null;
  const s = q.data;
  const localBuild = !!s && s.updateAvailable === null && !!s.latestDigest && !s.runningDigest;

  const status = !s ? null : s.inProgress || updating ? (
    <StatusBadge tone="info">Updating…</StatusBadge>
  ) : s.updateAvailable ? (
    <StatusBadge tone="warn">Update available</StatusBadge>
  ) : s.updateAvailable === false ? (
    <StatusBadge tone="ok">Up to date</StatusBadge>
  ) : localBuild ? (
    <Badge>Local build</Badge>
  ) : (
    <Badge>Unknown</Badge>
  );

  const go = () =>
    start.mutate(undefined, {
      onSuccess: (r) => {
        setConfirm(false);
        setUpdating(true);
        pushToast({ tone: "info", title: "Updating Nodewatch", body: r.message });
      },
      onError: (e) => {
        setConfirm(false);
        pushToast({ tone: "crit", title: "Update did not start", body: errorMessage(e) });
      },
    });

  return (
    <Card id="update" className="scroll-mt-20">
      <CardHeader title="Updates" icon={<ArrowUpCircle />} actions={status} />
      <CardBody className="flex flex-col gap-4">
        {q.isLoading ? (
          <Skeleton className="h-24" />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : s ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted">Running</dt>
                <dd className="num text-fg">{s.revision !== "dev" ? s.revision : short(s.runningDigest)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Latest published</dt>
                <dd className="num text-fg">{short(s.latestDigest)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted">Image</dt>
                <dd className="num break-all text-fg">{s.image}</dd>
              </div>
            </dl>
            {s.checkError ? <p className="text-sm text-muted">Could not reach Docker Hub: {s.checkError}</p> : null}
            {localBuild ? <p className="text-sm text-muted">This copy was built on the host. Updating switches it to the published image.</p> : null}
            {inline ? (
              <p className="flex items-start gap-1.5 text-sm text-muted">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                Live queries is inline: the pool's traffic runs through this container, so the update pauses paid serving for the restart (about 10 s). The tunnel reconnects by itself.
              </p>
            ) : null}
            {s.reason && !s.checkError ? <p className="text-sm text-muted">{s.reason}</p> : null}
            {s.last ? (
              <p className="flex items-start gap-1.5 text-sm text-muted">
                {s.last.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : null}
                Last update {fmtAgo(s.last.at, now)}: {s.last.message}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={() => setConfirm(true)}
                disabled={!s.canUpdate || updating || s.updateAvailable === false}
                loading={start.isPending}
              >
                {!start.isPending ? <ArrowUpCircle className="size-4" aria-hidden /> : null}
                Update Nodewatch
              </Button>
              <Button onClick={() => check.mutate()} loading={check.isPending}>
                {!check.isPending ? <RefreshCw className="size-4" aria-hidden /> : null}
                Check now
              </Button>
              {s.checkedAt ? <span className="text-xs text-muted">Checked {fmtAgo(s.checkedAt, now)}</span> : null}
            </div>
            {updating ? <p role="status" className="text-sm text-fg">Restarting into the new version. This page reloads when it is back, usually within a minute.</p> : null}
          </>
        ) : null}
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={go}
        title="Update Nodewatch now?"
        description="Nodewatch downloads the new image and restarts into it with the same settings. The dashboard is away for about a minute; your Arkiv node keeps running and serving. If the new version does not start healthy, the current one is put back automatically."
        confirmLabel="Update now"
        loading={start.isPending}
      />
    </Card>
  );
}
