"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Magnetic } from "./Magnetic";
import { useReducedMotion } from "@/lib/motion";

const CMD = "curl -fsSL https://raw.githubusercontent.com/rishabh-onerx/nodewatch/main/scripts/install.sh | sudo bash -s -- 0xYourWallet";

/** Hero: one sentence, one command. The headline reveals line by line; a slow light drifts behind. */
export function Hero({ ready }: { ready: boolean }) {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!ready || reduced || !root.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.fromTo(".hero-line > span", { yPercent: 110 }, { yPercent: 0, duration: 1.0, stagger: 0.1 }, 0.1)
        .fromTo(".hero-rest", { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08 }, 0.5);
      gsap.to(".light-a", { xPercent: 10, yPercent: -6, duration: 18, ease: "sine.inOut", yoyo: true, repeat: -1 });
    }, root);
    return () => ctx.revert();
  }, [ready, reduced]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* selectable text remains */
    }
  };
  const hidden = !(ready || reduced);

  return (
    <section ref={root} id="top" className="relative isolate overflow-hidden pt-36 pb-20 sm:pt-44 sm:pb-28">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="light-a absolute left-[10%] top-[-10%] h-[55vh] w-[55vw] rounded-full bg-signal/15 blur-[130px]" />
        <div className="light-a absolute right-0 top-[20%] h-[45vh] w-[40vw] rounded-full bg-violet/15 blur-[140px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-5 text-center sm:px-8">
        <h1 className="font-display text-[clamp(2.4rem,7vw,5.5rem)] leading-[1.02] text-ink" style={{ textWrap: "balance" }}>
          <span className="line hero-line">
            <span style={hidden ? { transform: "translateY(110%)" } : undefined}>Your Arkiv node,</span>
          </span>
          <span className="line hero-line">
            <span style={hidden ? { transform: "translateY(110%)" } : undefined}>
              <em className="not-italic text-gradient">looked after.</em>
            </span>
          </span>
        </h1>

        <p className="hero-rest mx-auto mt-6 max-w-md text-lg leading-relaxed text-ink-muted" style={hidden ? { opacity: 0 } : undefined}>
          One container next to your node. It tells you why the node is out of rotation, warns before the disk fills, and keeps you in the pool on its own.
        </p>

        <div className="hero-rest mx-auto mt-9 max-w-xl rounded-xl border border-line bg-panel p-1 text-left" style={hidden ? { opacity: 0 } : undefined}>
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-ink-muted">
            <span className="font-mono">install, on the node host</span>
            <button type="button" onClick={copy} className="min-h-8 rounded-full px-3 font-medium text-ink hover:text-signal">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="rounded-lg bg-ground px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-all text-ink">
            <code>
              curl -fsSL …/nodewatch/main/scripts/install.sh{"\n"}
              {"  "}| sudo bash -s -- <span className="text-signal">0xYourWallet</span>
            </code>
          </pre>
        </div>

        <div className="hero-rest mt-6 flex flex-wrap justify-center gap-3" style={hidden ? { opacity: 0 } : undefined}>
          <Magnetic href="#mvp" className="border border-line text-ink hover:border-signal/60" strength={0.25}>
            See the MVP
          </Magnetic>
          <Magnetic href="https://github.com/rishabh-onerx/nodewatch" className="text-ink-muted hover:text-ink" strength={0.2}>
            Source on GitHub
          </Magnetic>
        </div>
      </div>
    </section>
  );
}
