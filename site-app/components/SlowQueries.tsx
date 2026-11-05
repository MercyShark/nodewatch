"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Reveal } from "./Reveal";
import { useReducedMotion } from "@/lib/motion";

gsap.registerPlugin(ScrollTrigger);

// Real numbers from a 5,000-entity run: p95 in ms at 500 / 1,000 / 2,500 / 5,000.
const ROWS: { name: string; k: number; p: number[] }[] = [
  { name: "equality", k: 0.0, p: [3.6, 4.0, 3.9, 3.6] },
  { name: "prefix", k: -0.01, p: [3.7, 3.8, 4.1, 3.4] },
  { name: "range", k: 0.42, p: [4.9, 5.3, 7.3, 9.6] },
  { name: "or fan-out", k: 0.62, p: [4.4, 5.7, 11.8, 23.0] },
  { name: "and ×3", k: 0.84, p: [4.8, 7.0, 15.5, 33.2] },
  { name: "and ×5", k: 0.86, p: [4.7, 6.6, 15.4, 33.0] },
];
const SIZES = ["500", "1k", "2.5k", "5k"];

/** The slow-query finder: a heatmap that fills in as you scroll, and the three targets. */
export function SlowQueries() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".cell",
        { scale: 0.6, autoAlpha: 0 },
        { scale: 1, autoAlpha: 1, duration: 0.5, ease: "back.out(1.6)", stagger: { each: 0.03, from: "start", grid: [ROWS.length, SIZES.length] }, scrollTrigger: { trigger: ".heat", start: "top 75%", once: true } },
      );
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  const max = Math.max(...ROWS.flatMap((r) => r.p));

  return (
    <section ref={root} id="slow" className="mx-auto max-w-6xl px-5 sm:px-8">
      <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center">
        <Reveal>
          <h2 data-reveal className="font-display text-4xl leading-tight text-ink sm:text-5xl" style={{ textWrap: "balance" }}>
            Which queries will hurt at ten times the data?
          </h2>
          <p data-reveal className="mt-5 max-w-lg text-ink-muted">
            The slow-query finder loads test entities into your own node, grows the dataset step by step, and times 42 query shapes at every size. Each shape gets a growth factor: 0 means the index does its job, 1 means time follows the data.
          </p>
          <ul data-reveal className="mt-8 grid gap-3 text-sm">
            {[
              ["Own node", "your real node on Rabdi state, up to 5,000 entities"],
              ["Private node", "a throwaway Arkiv dev node on the same host, free, up to 50,000"],
              ["Live market", "read-only timings over the real pool entities"],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
                <span>
                  <span className="text-ink">{t}</span> <span className="text-ink-muted">· {d}</span>
                </span>
              </li>
            ))}
          </ul>
          <p data-reveal className="mt-8 text-sm text-ink-muted">
            Findings stay private: query text is encrypted at rest, a demo-safe switch shows shapes as #N only, and reports reach Arkiv's team through the encrypted vault.
          </p>
        </Reveal>

        <div className="heat rounded-2xl border border-line bg-panel p-5 sm:p-7">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-sm text-ink">p95 latency by shape and dataset size</span>
            <span className="font-mono text-xs text-ink-muted">ms</span>
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `7.5rem repeat(${SIZES.length}, minmax(0, 1fr)) 3rem` }}>
            <span />
            {SIZES.map((s) => (
              <span key={s} className="text-center font-mono text-xs text-ink-muted">
                {s}
              </span>
            ))}
            <span className="text-right font-mono text-xs text-ink-muted">k</span>
            {ROWS.map((r) => (
              <RowCells key={r.name} r={r} max={max} />
            ))}
          </div>
          <p className="mt-5 text-xs leading-relaxed text-ink-muted">
            Flat rows stay flat as data grows. AND chains follow the data: at 5,000 entities they are still 33 ms, well under the 250 ms line, but they are the ones to watch at 50,000.
          </p>
        </div>
      </div>
    </section>
  );
}

function RowCells({ r, max }: { r: { name: string; k: number; p: number[] }; max: number }) {
  return (
    <>
      <span className="self-center truncate font-mono text-xs text-ink">{r.name}</span>
      {r.p.map((v, i) => {
        const t = Math.log(v) / Math.log(max);
        return (
          <div key={i} className="cell grid h-10 place-items-center rounded-md font-mono text-xs text-ink" style={{ background: `color-mix(in oklab, var(--color-signal) ${Math.round(8 + t * 55)}%, var(--color-ground))` }}>
            {v.toFixed(v >= 10 ? 0 : 1)}
          </div>
        );
      })}
      <span className={`self-center text-right font-mono text-xs ${r.k >= 0.8 ? "text-warn" : "text-ink-muted"}`}>{r.k.toFixed(2)}</span>
    </>
  );
}
