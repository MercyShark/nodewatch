import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { dismissToast, toastStore, type ToastTone } from "@/lib/toast";
import { useStore } from "@/lib/store";
import { useMotionOk } from "@/lib/motion";
import { ToneIcon, toneVar, type Tone } from "./status";
import { cn } from "@/lib/cn";

const toTone = (t: ToastTone): Tone => t;

export function Toaster() {
  const toasts = useStore(toastStore);
  const motionOk = useMotionOk();
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed top-3 right-3 left-3 z-[100] flex flex-col items-end gap-2 sm:left-auto sm:w-96"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout={motionOk}
            initial={motionOk ? { opacity: 0, x: 24 } : false}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } }}
            exit={motionOk ? { opacity: 0, x: 24, transition: { duration: 0.14, ease: [0.7, 0, 0.84, 0] } } : { opacity: 0 }}
            className={cn(
              "pointer-events-auto flex w-full items-start gap-3 rounded-lg border py-3 pr-1 pl-3 shadow-xl shadow-navy/20",
            )}
            style={{
              background: `color-mix(in oklab, ${toneVar[toTone(t.tone)]} 12%, var(--surface-2))`,
              borderColor: `color-mix(in oklab, ${toneVar[toTone(t.tone)]} 45%, var(--border))`,
            }}
            role="status"
          >
            <ToneIcon tone={toTone(t.tone)} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{t.title}</p>
              {t.body ? <p className="mt-0.5 text-sm text-muted">{t.body}</p> : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(t.id)}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:text-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
