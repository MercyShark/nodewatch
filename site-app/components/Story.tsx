"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "@/lib/motion";

gsap.registerPlugin(ScrollTrigger);

type Scene = { key: string; tone: "ok" | "crit" | "warn"; verdict: string; detail: string; fix?: string; caption: string; sub: string };

const SCENES: Scene[] = [
  {
    key: "healthy",
    tone: "ok",
    verdict: "healthy",
    detail: "Serving the pool. Head lag 0, 10 peers, agreement 71 h left.",
    caption: "Most of the time it just says this.",
    sub: "One word, from a rule engine over the host, Docker, the execution and consensus clients, the tunnel and the marketplace entities.",
  },
  {
    key: "tunnel",
    tone: "crit",
    verdict: "tunnel_down",
    detail: "The frpc tunnel to the load balancer is not running. The pool stopped sending calls 15 s ago.",
    fix: "docker start arkiv-community-node-tunnel-1",
    caption: "Then one day the pool stops paying you.",
    sub: "nodes.arkiv.network shows out of rotation. Nodewatch names the cause, in 15 seconds, and gives you the exact command. Telegram pings you.",
  },
  {
    key: "disk",
    tone: "warn",
    verdict: "disk: 6 days left",
    detail: "Chain data grows 31 GB/day. At this rate the volume is full on Tuesday.",
    fix: "raise root_volume_gib, then growpart + resize2fs",
    caption: "And the one that would have got you next week.",
    sub: "A forecast from allocated bytes, because reth's database file is sparse and every other disk tool is wrong about it.",
  },
];

const TONE = { ok: "text-ok border-ok/40 bg-ok/10", crit: "text-crit border-crit/40 bg-crit/10", warn: "text-warn border-warn/40 bg-warn/10" };

/** Sticky scroll story: the console stays pinned while the verdict changes with scroll. */
export function Story() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !root.current) return;
    const ctx = gsap.context(() => {
      const steps = gsap.utils.toArray<HTMLElement>(".story-step");
      steps.forEach((el, i) => {
        ScrollTrigger.create({
          trigger: el,
          start: "top 60%",
          end: "bottom 60%",
          onEnter: () => setActive(i),
          onEnterBack: () => setActive(i),
        });
      });
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  const s = SCENES[active]!;

  return (
    <section ref={root} id="why" className="relative mx-auto max-w-6xl px-5 sm:px-8">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        {/* Pinned console */}
        <div className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-2xl border border-line bg-panel p-1 shadow-[0_30px_80px_-30px_rgba(90,209,255,0.25)]">
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-ink-muted">
              <span className="size-2 rounded-full bg-line" />
              <span className="size-2 rounded-full bg-line" />
              <span className="size-2 rounded-full bg-line" />
              <span className="ml-3 font-mono">nodewatch · overview</span>
            </div>
            <div className="rounded-xl bg-ground p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <span className={`rounded-full border px-3 py-1 font-mono text-sm transition-colors duration-500 ${TONE[s.tone]}`}>{s.verdict}</span>
                <span className="font-mono text-xs text-ink-muted">learing-test-rishabh · rabdi</span>
              </div>
              <p key={s.key + "-d"} className="mt-6 min-h-[3.5rem] text-lg leading-snug text-ink motion-safe:animate-[fade_500ms_ease-out]">
                {s.detail}
              </p>
              <div className="mt-6 min-h-[3.25rem]">
                {s.fix ? (
                  <div key={s.key + "-f"} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-3 font-mono text-sm text-ink motion-safe:animate-[fade_500ms_ease-out]">
                    <code className="truncate">{s.fix}</code>
                    <span className="shrink-0 text-xs text-ink-muted">copy</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    {[
                      ["head lag", "0 blk"],
                      ["peers", "10 / 7"],
                      ["disk", "958 GiB free"],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg border border-line bg-panel px-3 py-2">
                        <div className="text-xs text-ink-muted">{k}</div>
                        <div className="font-mono text-ink">{v}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Scrolling captions */}
        <div className="flex flex-col">
          {SCENES.map((sc, i) => (
            <div key={sc.key} className="story-step flex min-h-[70vh] flex-col justify-center py-10 lg:min-h-[80vh]">
              <h2 className={`font-display text-4xl leading-tight transition-colors duration-500 sm:text-5xl ${active === i || reduced ? "text-ink" : "text-ink/30"}`} style={{ textWrap: "balance" }}>
                {sc.caption}
              </h2>
              <p className={`mt-5 max-w-md text-base leading-relaxed transition-colors duration-500 ${active === i || reduced ? "text-ink-muted" : "text-ink-muted/40"}`}>{sc.sub}</p>
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes fade { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>
    </section>
  );
}
