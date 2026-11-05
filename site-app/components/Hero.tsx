"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { motion } from "motion/react";
import { Magnetic } from "./Magnetic";
import { EASE, useReducedMotion } from "@/lib/motion";

const HEADLINE = ["Your node dropped", "out of rotation.", "Now you know why."];

/** Hero: the headline reveals line by line, the subtitle and actions follow, and a slow light drifts behind. */
export function Hero({ ready }: { ready: boolean }) {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!ready || reduced || !root.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.fromTo(".hero-line > span", { yPercent: 110 }, { yPercent: 0, duration: 1.1, stagger: 0.12 }, 0.1)
        .fromTo(".hero-sub", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.55)
        .fromTo(".hero-cta", { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08 }, 0.75)
        .fromTo(".hero-proof", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8 }, 1.0);
      // Ambient: two lights drift very slowly. Transform-only, GPU friendly.
      gsap.to(".light-a", { xPercent: 12, yPercent: -8, duration: 18, ease: "sine.inOut", yoyo: true, repeat: -1 });
      gsap.to(".light-b", { xPercent: -10, yPercent: 10, duration: 22, ease: "sine.inOut", yoyo: true, repeat: -1 });
      // Parallax on scroll: the lights move slower than the page.
      gsap.to(".hero-lights", { yPercent: 25, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true } });
    }, root);
    return () => ctx.revert();
  }, [ready, reduced]);

  const visible = ready || reduced;

  return (
    <section ref={root} id="top" className="grain relative isolate overflow-hidden pt-32 pb-24 sm:pt-40 sm:pb-32">
      <div className="hero-lights pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="light-a absolute left-0 top-[-20%] h-[60vh] w-[60vw] rounded-full bg-signal/20 blur-[120px]" />
        <div className="light-b absolute right-0 top-[10%] h-[50vh] w-[50vw] rounded-full bg-signal-deep/25 blur-[140px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_40%,var(--color-ground)_85%)]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <h1 className="font-display text-[clamp(2.6rem,8vw,6.5rem)] leading-[0.98] text-ink" style={{ textWrap: "balance" }}>
          {HEADLINE.map((l, i) => (
            <span key={i} className="line hero-line">
              <span style={!visible ? { transform: "translateY(110%)" } : undefined}>
                {i === 2 ? <em className="not-italic text-signal">{l}</em> : l}
              </span>
            </span>
          ))}
        </h1>

        <p className="hero-sub mt-8 max-w-xl text-lg leading-relaxed text-ink-muted" style={!visible ? { opacity: 0 } : undefined}>
          Nodewatch runs next to your Arkiv node and shows what only the inside of the host can see. One container. One command to install. One wallet can open it: yours.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <span className="hero-cta" style={!visible ? { opacity: 0 } : undefined}>
            <Magnetic href="#install" className="bg-signal text-ground hover:bg-[#7fdcff]">
              Install in one command
            </Magnetic>
          </span>
          <span className="hero-cta" style={!visible ? { opacity: 0 } : undefined}>
            <Magnetic href="#inside" className="border border-line text-ink hover:border-signal/60" strength={0.25}>
              See what it sees
            </Magnetic>
          </span>
        </div>

        <motion.dl
          className="hero-proof mt-16 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-6 border-t border-line pt-8 sm:grid-cols-4"
          style={!visible ? { opacity: 0 } : undefined}
          initial={false}
          transition={{ duration: 0.6, ease: EASE }}
        >
          {[
            ["1", "container, next to the node"],
            ["42", "query shapes benchmarked"],
            ["~2 min", "until a dead node is visible on Arkiv"],
            ["0", "extra cloud services"],
          ].map(([n, l]) => (
            <div key={l}>
              <dt className="font-mono text-2xl text-ink tabular-nums">{n}</dt>
              <dd className="mt-1 text-sm text-ink-muted">{l}</dd>
            </div>
          ))}
        </motion.dl>
      </div>
    </section>
  );
}
