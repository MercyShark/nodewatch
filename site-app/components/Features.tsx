"use client";

import { Reveal } from "./Reveal";
import { Rocket, Activity, Send, Siren, Database } from "lucide-react";

type Item = { icon: typeof Rocket; title: string; body: string; code?: string; wide?: boolean };

/** The MVP, five things. The grid is a bento: three up, two across. */
const ITEMS: Item[] = [
  {
    icon: Rocket,
    title: "One-click setup",
    body: "One command on the node host. It reads the provider address, binds the console to your wallet and starts in under four minutes.",
    code: "curl -fsSL …/install.sh | sudo bash -s -- 0xYourWallet",
    wide: true,
  },
  {
    icon: Activity,
    title: "Metric finder",
    body: "Host, containers, chain and pool in one view. The slow-query finder shows which Arkiv query shapes get slow as data grows.",
  },
  {
    icon: Send,
    title: "Telegram alerts",
    body: "Warnings and criticals with the verdict and the fix command. One script connects the bot.",
    code: "sudo bash scripts/setup-telegram.sh",
  },
  {
    icon: Siren,
    title: "PagerDuty incidents",
    body: "Criticals open an incident with a dedup key and resolve themselves when the node recovers.",
    code: "sudo bash scripts/setup-pagerduty.sh",
  },
  {
    icon: Database,
    title: "Backup on Swarm",
    body: "Keystore, node .env and tunnel config, encrypted to your wallet, stored on Swarm and on local disk.",
  },
];

export function Features() {
  return (
    <section id="mvp" className="mx-auto max-w-6xl scroll-mt-24 px-5 sm:px-8">
      <Reveal stagger={0.08}>
        <p data-reveal className="font-mono text-xs tracking-[0.2em] text-signal">THE MVP</p>
        <h2 data-reveal className="font-display mt-3 text-4xl text-ink sm:text-5xl">
          Five things, <span className="text-gradient">shipped.</span>
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-6">
          {ITEMS.map((it) => (
            <article key={it.title} data-reveal className={`card p-6 ${it.wide ? "md:col-span-4" : "md:col-span-2"}`}>
              <span className="inline-grid size-10 place-items-center rounded-xl bg-signal/10 text-signal">
                <it.icon className="size-5" strokeWidth={1.5} aria-hidden />
              </span>
              <h3 className="font-display mt-5 text-xl text-ink">{it.title}</h3>
              <p className="mt-2 text-ink-muted">{it.body}</p>
              {it.code ? (
                <pre className="mt-4 overflow-hidden rounded-lg border border-line bg-ground px-3 py-2 font-mono text-[13px] text-ink whitespace-pre-wrap break-all">
                  <code>{it.code}</code>
                </pre>
              ) : null}
            </article>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
