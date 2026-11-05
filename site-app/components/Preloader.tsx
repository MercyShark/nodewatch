"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Pulse } from "./Pulse";
import { useReducedMotion } from "@/lib/motion";

/**
 * Loading screen. The counter follows real readiness: fonts (40 %), the document (40 %), the first frame (20 %),
 * eased so it never jumps. It finishes within ~1.4 s even on a fast machine, so the intro is seen but not waited for.
 */
export function Preloader({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion();
  const [target, setTarget] = useState(0);
  const [shown, setShown] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (reduced) {
      onDone();
      return;
    }
    let t = 0;
    const add = (n: number) => setTarget((v) => Math.min(100, v + n));
    document.fonts?.ready.then(() => add(40)).catch(() => add(40));
    if (document.readyState === "complete") add(40);
    else window.addEventListener("load", () => add(40), { once: true });
    requestAnimationFrame(() => requestAnimationFrame(() => add(20)));
    // Minimum visible time so the mark can draw; after that, readiness decides.
    const floor = setTimeout(() => {
      t = 1;
      setTarget((v) => Math.max(v, 1));
    }, 900);
    return () => clearTimeout(floor);
  }, [reduced, onDone]);

  // Ease the shown number toward the target.
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const step = () => {
      setShown((s) => {
        const next = s + (target - s) * 0.12;
        return target - next < 0.4 ? target : next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  useEffect(() => {
    if (shown >= 100 && !leaving) {
      const t = setTimeout(() => setLeaving(true), 250);
      return () => clearTimeout(t);
    }
  }, [shown, leaving]);

  if (reduced) return null;
  const pct = Math.round(shown);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {!leaving && (
        <motion.div
          key="preloader"
          className="fixed inset-0 z-50 grid place-items-center bg-ground"
          exit={{ y: "-100%" }}
          transition={{ duration: 0.9, ease: [0.76, 0, 0.24, 1] }}
          aria-live="polite"
          aria-label={`Loading ${pct} percent`}
        >
          <div className="flex flex-col items-center gap-8">
            <Pulse progress={shown / 100} width={200} />
            <div className="flex items-baseline gap-3 font-mono text-ink-muted">
              <span className="text-5xl text-ink tabular-nums">{pct.toString().padStart(3, "0")}</span>
              <span className="text-sm">bringing the node online</span>
            </div>
            <div className="h-px w-56 overflow-hidden bg-line">
              <div className="h-full bg-signal" style={{ width: `${shown}%`, transition: "width 120ms linear" }} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
