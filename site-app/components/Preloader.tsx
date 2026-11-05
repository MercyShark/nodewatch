"use client";

import { useEffect, useRef, useState } from "react";
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
    const add = (n: number) => setTarget((v) => Math.min(100, v + n));
    // Readiness signals. Each may have happened already by the time this runs, so check state first.
    if (document.fonts?.status === "loaded") add(40);
    else document.fonts?.ready.then(() => add(40)).catch(() => add(40));
    if (document.readyState === "complete") add(40);
    else window.addEventListener("load", () => add(40), { once: true });
    requestAnimationFrame(() => requestAnimationFrame(() => add(20)));
    // Hard ceiling: whatever the signals do, the intro is over by 0.9 s. A preloader must never stall, and on a
    // minimal page it must read as a flourish, not a wait.
    const ceiling = setTimeout(() => setTarget(100), 900);
    return () => clearTimeout(ceiling);
  }, [reduced, onDone]);

  // Ease the shown number toward the target by elapsed time, not by frame count, so a throttled tab (1 frame
  // every 500 ms) still gets the same curve. A plain timer forces the exit by 2 s no matter what.
  const targetRef = useRef(0);
  targetRef.current = target;
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      setShown((s) => {
        const t = targetRef.current;
        const next = s + (t - s) * Math.min(1, dt * 7);
        return t - next < 0.3 ? t : next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const force = setTimeout(() => setShown(100), 1200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(force);
    };
  }, [reduced]);

  useEffect(() => {
    if (shown >= 100 && !leaving) {
      const t = setTimeout(() => setLeaving(true), 150);
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
          transition={{ duration: 0.7, ease: [0.76, 0, 0.24, 1] }}
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
