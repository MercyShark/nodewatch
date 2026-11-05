"use client";

import { Reveal } from "./Reveal";

/** What it does: three lines. No cards, no icons, no sub-bullets. */
const ITEMS: [string, string][] = [
  ["Says why", "One verdict with the command that fixes it: tunnel down, lagging, no agreement, low gas."],
  ["Sees ahead", "A disk forecast with a date, and alerts on Telegram before anything breaks."],
  ["Keeps you in", "Re-posts the offer and renews the tunnel when the agreement ends. No one has to be there."],
];

export function Features() {
  return (
    <section id="inside" className="mx-auto max-w-3xl px-5 sm:px-8">
      <Reveal className="grid gap-8 sm:grid-cols-3" stagger={0.1}>
        {ITEMS.map(([t, d]) => (
          <div key={t} data-reveal>
            <h2 className="font-display text-2xl text-ink">{t}</h2>
            <p className="mt-2 text-ink-muted">{d}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
