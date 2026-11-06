"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { AnimatedSpan, Terminal, TypingAnimation } from "@/components/magicui/terminal";
import { IMAGE } from "@/lib/site";
import { useReady } from "./LoaderGate";

const LINES: [mark: string, text: string][] = [
  ["✔", "Found the Arkiv node: execution, consensus, tunnel"],
  ["✔", "Provider read from the node kit"],
  ["✔", "Telegram linked · PagerDuty ready"],
  ["✔", "Verdict: healthy · head lag 0 · 10 peers"],
  ["→", "Watching. You can close this terminal."],
];

function DemoTerminal() {
  const reduced = useReducedMotion();
  const cmd = `docker run -d --network host … ${IMAGE}`;
  if (reduced)
    return (
      <Terminal sequence={false}>
        <span className="text-sm text-white">$ {cmd}</span>
        {LINES.map(([m, t]) => (
          <span key={t} className="text-sm">
            <span className={m === "✔" ? "text-mint" : "text-dusk"}>{m}</span> {t}
          </span>
        ))}
      </Terminal>
    );
  return (
    <Terminal>
      <TypingAnimation duration={28} className="text-sm text-white">{`$ ${cmd}`}</TypingAnimation>
      {LINES.map(([m, t]) => (
        <AnimatedSpan key={t} className="text-sm text-[#e8f0fb]">
          <span>
            <span className={m === "✔" ? "text-mint" : "text-dusk"}>{m}</span> {t}
          </span>
        </AnimatedSpan>
      ))}
    </Terminal>
  );
}

const rise = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0 } };

export function Hero() {
  const ready = useReady();
  const anim = { initial: "hidden", animate: ready ? "show" : "hidden", transition: { staggerChildren: 0.08 } };
  return (
    <section id="top" className="relative isolate overflow-hidden">
      <div className="dots pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-white/35 blur-[120px]"
        aria-hidden="true"
      />
      <div className="mx-auto grid min-h-[100svh] max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-5 pt-28 pb-16 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10 lg:pt-24">
        <motion.div {...anim} className="min-w-0">
          <motion.p variants={rise} className="inline-flex items-center gap-2 rounded-full border border-navy/20 bg-white/25 px-3 py-1 font-mono text-xs tracking-wide text-navy">
            <span className="size-1.5 rounded-full bg-navy" aria-hidden="true" /> For Arkiv node operators
          </motion.p>
          <motion.h1 variants={rise} className="mt-6 text-[clamp(2.6rem,6.2vw,4.9rem)] leading-[1.02] font-bold tracking-[-0.035em] text-navy" style={{ textWrap: "balance" }}>
            Starting a node is easy. Keeping it alive is the hard part.
          </motion.h1>
          <motion.p variants={rise} className="mt-6 max-w-xl text-lg leading-relaxed text-navy/80">
            Nobody can watch a node all day. Nodewatch does. It tracks every metric, tells you what broke, pings Telegram and PagerDuty, and restarts the failed container in one click.
          </motion.p>
          <motion.div variants={rise} className="mt-9 flex flex-wrap gap-3">
            <a
              href="#install"
              className="group inline-flex min-h-12 items-center gap-2 rounded-full bg-navy px-6 font-medium text-white transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0"
            >
              Install with Docker
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </a>
            <a href="#features" className="inline-flex min-h-12 items-center gap-2 rounded-full border border-navy/30 px-6 font-medium text-navy transition-colors hover:bg-white/25">
              What it does
              <ArrowDown className="size-4" aria-hidden="true" />
            </a>
          </motion.div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-h-[300px] min-w-0 justify-center lg:justify-end"
        >
          {/* Mounted after the loader, so the typing starts in front of the visitor, not behind the curtain. */}
          {ready ? <DemoTerminal /> : null}
        </motion.div>
      </div>
    </section>
  );
}
