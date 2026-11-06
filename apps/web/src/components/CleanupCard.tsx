import { useEffect, useState } from "react";
import { Eraser } from "lucide-react";
import type { CleanupItemId } from "@nodewatch/shared";
import { useCleanup, useCleanupPreview } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { pushToast } from "@/lib/toast";
import { useIsAdmin } from "@/lib/auth";
import { fmtGB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/feedback";

const MIN_BYTES = 50e6; // below this an item is not worth a click

/** Free disk space that is safe to free: Docker build cache and untagged images. Chain data is never touched. */
export function CleanupCard() {
  const admin = useIsAdmin();
  const q = useCleanupPreview(admin);
  const run = useCleanup();
  const [picked, setPicked] = useState<Set<CleanupItemId>>(new Set());
  const [open, setOpen] = useState(false);

  // Pre-select everything worth freeing once the preview arrives.
  useEffect(() => {
    if (q.data) setPicked(new Set(q.data.items.filter((i) => i.bytes >= MIN_BYTES).map((i) => i.id)));
  }, [q.data]);

  // Arrive from the verdict's "Free up disk space" link scrolled to this card.
  useEffect(() => {
    if (window.location.hash === "#cleanup") document.getElementById("cleanup")?.scrollIntoView({ block: "start" });
  }, []);

  if (!admin) return null;
  const items = q.data?.items ?? [];
  const total = items.filter((i) => picked.has(i.id)).reduce((a, i) => a + i.bytes, 0);
  const toggle = (id: CleanupItemId) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const go = () =>
    run.mutate([...picked], {
      onSuccess: (r) => {
        setOpen(false);
        const failed = r.results.filter((x) => !x.ok);
        pushToast(
          failed.length
            ? { tone: "warn", title: `Freed ${fmtGB(r.reclaimedBytes)}`, body: failed.map((f) => `${f.id}: ${f.error}`).join("; ") }
            : { tone: "ok", title: `Freed ${fmtGB(r.reclaimedBytes)}`, body: "The disk panel updates on its next sample." },
        );
      },
      onError: (e) => {
        setOpen(false);
        pushToast({ tone: "crit", title: "Cleanup did not run", body: errorMessage(e) });
      },
    });

  return (
    <Card id="cleanup" className="scroll-mt-20">
      <CardHeader
        icon={<Eraser />}
        title="Free up disk space"
        description="Docker leftovers only. Chain data, volumes and tagged images are never touched."
        actions={
          <Button variant="primary" size="sm" disabled={!total || !q.data?.available} onClick={() => setOpen(true)} loading={run.isPending}>
            {total ? `Free ${fmtGB(total)}` : "Nothing to free"}
          </Button>
        }
      />
      <CardBody>
        {q.isLoading ? (
          <Skeleton className="h-16" />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.available ? (
          <p className="text-sm text-muted">Unavailable: {q.data?.reason ?? "Docker is not visible to Nodewatch."}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((i) => (
              <li key={i.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <input
                  id={`cleanup-${i.id}`}
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--primary)]"
                  checked={picked.has(i.id)}
                  disabled={i.bytes === 0}
                  onChange={() => toggle(i.id)}
                />
                <label htmlFor={`cleanup-${i.id}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-fg">{i.label}</span>
                    <span className="num text-sm text-fg">{fmtGB(i.bytes)}</span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">{i.detail}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={go}
        title={`Free about ${fmtGB(total)}?`}
        description="Removes the selected Docker build cache and untagged images. Running containers, tagged images and volumes, including the chain data, are kept. This cannot be undone, but nothing here is needed to run the node."
        confirmLabel={`Free ${fmtGB(total)}`}
        loading={run.isPending}
      />
    </Card>
  );
}
