"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * The opening: a chain of blocks fills in while a heartbeat runs through it, a big counter climbs, and four boot
 * steps tick off. Then the navy screen leaves as eight columns sliding up one after another.
 *
 * Timing is driven by elapsed time, not frames, so a throttled tab gets the same curve. It finishes in ~1.2 s, waits a
 * little for fonts at most, and a hard timer ends it at 2.2 s whatever happens. Click or Escape skips it. With
 * reduced motion it never shows. If scripts fail entirely, a CSS fail-safe hides it after 4 s.
 */
const BLOCKS = 7;
const COLUMNS = 8;
const STEPS = ["Finding the node", "Reading metrics", "Linking alerts", "Watching"];
const BASE_MS = 1200;
const CEILING_MS = 2200;
const EASE_IN_OUT: [number, number, number, number] = [0.76, 0, 0.24, 1];

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function Loader({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion();
  const [p, setP] = useState(0); // 0..1
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const fontsReady = useRef(false);

  // Reduced motion: no loader at all.
  useEffect(() => {
    if (reduced) {
      setGone(true);
      onDone();
    }
  }, [reduced, onDone]);

  // Progress by elapsed time; hold at 92 % until fonts are in, never past the ceiling.
  useEffect(() => {
    if (reduced) return;
    document.documentElement.style.overflow = "hidden";
    document.fonts?.ready.then(() => (fontsReady.current = true)).catch(() => (fontsReady.current = true));
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const el = performance.now() - t0;
      let v = easeOut(Math.min(1, el / BASE_MS));
      if (!fontsReady.current && el < CEILING_MS) v = Math.min(v, 0.92);
      setP(v);
      if (v < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const force = setTimeout(() => setP(1), CEILING_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(force);
    };
  }, [reduced]);

  // At 100 %, pause a beat on "Watching", then leave.
  useEffect(() => {
    if (p < 1 || leaving) return;
    const t = setTimeout(() => setLeaving(true), 150);
    return () => clearTimeout(t);
  }, [p, leaving]);

  // Skip on click or Escape.
  useEffect(() => {
    if (reduced || gone) return;
    const skip = () => {
      setP(1);
      setLeaving(true);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && skip();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [reduced, gone]);

  const finish = () => {
    document.documentElement.style.overflow = "";
    setGone(true);
    onDone();
  };

  if (gone) return null;
  const pct = Math.round(p * 100);
  const lit = Math.min(BLOCKS, Math.floor(p * (BLOCKS + 0.999)));
  const step = Math.min(STEPS.length - 1, Math.floor(p * STEPS.length * 0.999 + (p >= 1 ? 1 : 0)));

  return (
    <div
      className="nw-loader fixed inset-0 z-[100] cursor-pointer"
      role="status"
      aria-live="polite"
      aria-label={`Loading Nodewatch, ${pct} percent`}
      onClick={() => {
        setP(1);
        setLeaving(true);
      }}
    >
      {/* The navy screen, as columns that slide up on exit. */}
      <div className="absolute inset-0 flex" aria-hidden="true">
        {Array.from({ length: COLUMNS }, (_, i) => (
          <motion.div
            key={i}
            className="h-full flex-1 bg-navy"
            style={{ marginLeft: i ? -1 : 0 }}
            initial={{ y: 0 }}
            animate={leaving ? { y: "-101%" } : { y: 0 }}
            transition={{ duration: 0.55, ease: EASE_IN_OUT, delay: leaving ? i * 0.04 : 0 }}
            onAnimationComplete={() => leaving && i === COLUMNS - 1 && finish()}
          />
        ))}
      </div>

      <AnimatePresence>
        {!leaving && (
          <motion.div
            key="content"
            className="relative flex h-full flex-col justify-between px-5 py-6 text-dusk sm:px-10 sm:py-9"
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            {/* Top: mark and network */}
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2.5">
                <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
                  <rect width="32" height="32" rx="8" fill="#8fb4e3" />
                  <path d="M4 17h6l3-8 5 15 3-7h7" fill="none" stroke="#0d1a33" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-lg font-bold tracking-[-0.02em] text-white">Nodewatch</span>
              </span>
              <span className="hidden font-mono text-xs tracking-[0.2em] sm:inline">ARKIV · RABDI · 7794095</span>
            </div>

            {/* Middle: the chain. Each block lights up in turn; a heartbeat runs along each link as it is reached. */}
            <div
              className="mx-auto grid w-full max-w-5xl items-center"
              style={{ gridTemplateColumns: `repeat(${BLOCKS - 1}, auto minmax(0, 1fr)) auto` }}
            >
              {Array.from({ length: BLOCKS }, (_, i) => {
                const on = i < lit;
                const linkOn = i < lit - 1;
                return [
                  <motion.div
                    key={`b${i}`}
                    className="relative grid place-items-center rounded-xl border sm:rounded-2xl"
                    style={{ width: "clamp(30px, 6.6vw, 80px)", height: "clamp(30px, 6.6vw, 80px)" }}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      backgroundColor: on ? "#8fb4e3" : "#0d1a33",
                      borderColor: on ? "#8fb4e3" : "rgba(143,180,227,0.3)",
                      scale: on ? 1 : 0.92,
                    }}
                    transition={{ duration: 0.35, delay: on ? 0 : i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <span className={`font-mono text-[8px] sm:text-xs ${on ? "text-navy" : "text-dusk/55"}`}>#{String(i + 1).padStart(2, "0")}</span>
                  </motion.div>,
                  i < BLOCKS - 1 ? (
                    <div key={`l${i}`} className="flex items-center px-1 sm:px-2" aria-hidden="true">
                      <span className="relative h-px flex-1 bg-dusk/20">
                        <span className="absolute inset-0 origin-left bg-white transition-transform duration-200 ease-out" style={{ transform: `scaleX(${linkOn ? 1 : 0})` }} />
                      </span>
                      <svg viewBox="0 0 28 24" className="hidden h-6 w-7 shrink-0 sm:block">
                        <path d="M0 12 H6 L10 3 L16 21 L20 12 H28" stroke="#8fb4e3" strokeOpacity="0.2" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
                        <motion.path
                          d="M0 12 H6 L10 3 L16 21 L20 12 H28"
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: linkOn ? 1 : 0 }}
                          transition={{ duration: 0.16, delay: linkOn ? 0.08 : 0, ease: "easeOut" }}
                        />
                      </svg>
                      <span className="relative h-px flex-1 bg-dusk/20">
                        <span
                          className="absolute inset-0 origin-left bg-white transition-transform duration-200 ease-out"
                          style={{ transform: `scaleX(${linkOn ? 1 : 0})`, transitionDelay: linkOn ? "170ms" : "0ms" }}
                        />
                      </span>
                    </div>
                  ) : null,
                ];
              })}
            </div>

            {/* Bottom: the big counter and the boot steps */}
            <div className="flex items-end justify-between gap-6">
              <p className="leading-[0.8] font-bold tracking-[-0.06em] text-dusk tabular-nums" style={{ fontSize: "clamp(5.5rem, 19vw, 16rem)" }}>
                {String(pct).padStart(3, "0")}
                <span className="ml-1 align-top text-[0.28em] tracking-normal text-dusk/70">%</span>
              </p>
              <ul className="mb-2 hidden flex-col gap-2 font-mono text-sm sm:flex">
                {STEPS.map((s, i) => {
                  const state = i < step ? "done" : i === step ? "now" : "next";
                  return (
                    <li key={s} className={`flex items-center gap-2.5 ${state === "next" ? "text-dusk/40" : state === "now" ? "text-white" : "text-dusk"}`}>
                      <span className="w-4 text-center" aria-hidden="true">
                        {state === "done" ? "✓" : state === "now" ? "›" : "·"}
                      </span>
                      {s}
                    </li>
                  );
                })}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
