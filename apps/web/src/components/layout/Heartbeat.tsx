import { AnimatePresence, motion } from "framer-motion";
import { useOverview } from "@/lib/queries";
import { liveStore } from "@/lib/stream";
import { useStore } from "@/lib/store";
import { useMotionOk } from "@/lib/motion";
import { useNow } from "@/components/ui/time";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Live heartbeat indicator. The pulse fires only when a heartbeat transaction lands on Arkiv
 * (a new lastTxHash arrives over SSE), never on a timer.
 */
export function HeartbeatIndicator({ compact }: { compact?: boolean }) {
  const { data } = useOverview();
  const beat = useStore(liveStore, (s) => s.heartbeatBeat);
  const status = useStore(liveStore, (s) => s.status);
  const motionOk = useMotionOk();
  const now = useNow(5000);
  const hb = data?.heartbeat;
  const failing = (hb?.failuresInRow ?? 0) >= 3;
  const tone = !hb ? "neutral" : !hb.enabled ? "neutral" : failing ? "crit" : hb.failuresInRow > 0 ? "warn" : "ok";
  const color = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", neutral: "var(--fg-muted)" }[tone];
  const text = !hb
    ? "Heartbeat"
    : !hb.enabled
      ? "Heartbeat off"
      : failing
        ? `Heartbeat failing (${hb.failuresInRow}×)`
        : `Heartbeat ${fmtAgo(hb.lastAt, now)}`;
  const streamText = status === "open" ? "live" : status === "closed" ? "offline" : "reconnecting";

  return (
    <div
      className="flex min-w-0 items-center gap-2 text-xs text-muted"
      title={hb?.reason ?? (hb?.lastTxHash ? `Last tx ${hb.lastTxHash}` : undefined)}
    >
      <span className="relative inline-flex size-3 items-center justify-center" aria-hidden>
        <AnimatePresence>
          {motionOk && beat > 0 ? (
            <motion.span
              key={beat}
              className="absolute inset-0 rounded-full"
              style={{ background: color }}
              initial={{ scale: 1, opacity: 0.7 }}
              animate={{ scale: 3, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            />
          ) : null}
        </AnimatePresence>
        <span className="relative size-2.5 rounded-full" style={{ background: color }} />
      </span>
      <span className={cn("truncate", compact && "max-md:sr-only")}>
        <span className="text-fg">{text}</span>
        <span className="hidden sm:inline">
          {" · "}
          <span className={status === "open" ? "text-muted" : "text-warn"}>stream {streamText}</span>
        </span>
      </span>
    </div>
  );
}
