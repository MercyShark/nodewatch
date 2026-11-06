import { useState } from "react";
import { Link } from "react-router-dom";
import { HardDriveDownload, Wrench } from "lucide-react";
import type { FixAction, Verdict } from "@nodewatch/shared";
import { useAutopilot, useFix } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { pushToast } from "@/lib/toast";
import { useIsAdmin } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";

const SERVICE_NOTE: Record<string, string> = {
  execution: "The execution client gets up to 3 minutes to stop cleanly before it starts again, so the node may be out of rotation for a few minutes.",
  consensus: "The consensus client gets up to 1 minute to stop cleanly before it starts again.",
  tunnel: "The pool cannot reach the node for a few seconds while the tunnel reconnects.",
};

function describe(a: FixAction): { label: string; title: string; body: string } {
  if (a.kind === "restart_service")
    return {
      label: `Restart ${a.service}`,
      title: `Restart the ${a.service} container?`,
      body: `Nodewatch starts it if it is stopped, or restarts it if it is running. ${SERVICE_NOTE[a.service] ?? ""}`,
    };
  return {
    label: "Rejoin the pool",
    title: "Run the autopilot once?",
    body: "It checks the node is synced and the pool has room, then posts a new offer signed by the provider key. It costs a little gas from the provider wallet.",
  };
}

/** One-click fix for the current verdict. Admin only; the server re-checks the verdict before acting. */
export function FixButton({ verdict }: { verdict: Verdict }) {
  const admin = useIsAdmin();
  const action = verdict.action ?? null;
  const fix = useFix();
  const autopilot = useAutopilot(admin && action?.kind === "autopilot_run");
  const [open, setOpen] = useState(false);
  if (!admin || !action) return null;

  if (action.kind === "disk_cleanup")
    return (
      <Link to="/resources#cleanup" className="inline-flex">
        <Button variant="primary" size="sm">
          <HardDriveDownload className="size-4" aria-hidden />
          Free up disk space
        </Button>
      </Link>
    );

  const d = describe(action);
  const locked = action.kind === "autopilot_run" && autopilot.data && !autopilot.data.keyUnlocked;
  const run = () =>
    fix.mutate(verdict.code, {
      onSuccess: (r) => {
        setOpen(false);
        pushToast({ tone: "ok", title: "Fix started", body: `${r.message[0]?.toUpperCase()}${r.message.slice(1)}. The verdict updates within about 15 seconds.` });
      },
      onError: (e) => {
        setOpen(false);
        pushToast({ tone: "crit", title: "Fix did not run", body: errorMessage(e) });
      },
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={!!locked} loading={fix.isPending}>
        {!fix.isPending ? <Wrench className="size-4" aria-hidden /> : null}
        Fix it: {d.label.toLowerCase()}
      </Button>
      {locked ? (
        <span className="text-xs text-muted">
          Unlock the provider key in <Link className="underline underline-offset-2 hover:text-fg" to="/pool">Pool → Autopilot</Link> first.
        </span>
      ) : null}
      <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={run} title={d.title} description={d.body} confirmLabel={d.label} loading={fix.isPending} />
    </div>
  );
}
