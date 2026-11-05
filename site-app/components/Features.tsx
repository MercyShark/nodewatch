"use client";

import { Reveal } from "./Reveal";
import { Tilt } from "./Tilt";

/** What only a tool next to the node can see. Three tilt cards, then a plain list: the cards are the three big ideas. */
export function Features() {
  return (
    <section id="inside" className="mx-auto max-w-6xl px-5 sm:px-8">
      <Reveal>
        <h2 data-reveal className="font-display max-w-2xl text-4xl leading-tight text-ink sm:text-5xl" style={{ textWrap: "balance" }}>
          nodes.arkiv.network sees your node from the outside. This is the inside.
        </h2>
        <p data-reveal className="mt-5 max-w-xl text-ink-muted">
          Three things no external monitor can do, because they need the host, the keys, or the chain itself.
        </p>
      </Reveal>

      <Reveal className="mt-14 grid gap-5 lg:grid-cols-3" stagger={0.12}>
        <div data-reveal>
          <Tilt className="h-full rounded-2xl border border-line bg-panel p-7">
            <HeartbeatGlyph />
            <h3 className="mt-6 text-xl font-medium text-ink">A heartbeat on the chain</h3>
            <p className="mt-3 text-ink-muted">
              Every 30 seconds Nodewatch renews an Arkiv entity that expires two minutes later. If the host dies, the entity vanishes. Anyone can check it with one query, and no monitoring server exists.
            </p>
            <pre className="mt-5 overflow-x-auto rounded-lg bg-ground p-3 font-mono text-xs leading-relaxed text-ink-muted">
              <code>{`arkiv.schema = str('nodewatch.heartbeat')\n  AND status = str('degraded')`}</code>
            </pre>
          </Tilt>
        </div>
        <div data-reveal>
          <Tilt className="h-full rounded-2xl border border-line bg-panel p-7">
            <ForecastGlyph />
            <h3 className="mt-6 text-xl font-medium text-ink">A disk forecast that is right</h3>
            <p className="mt-3 text-ink-muted">
              Measures allocated bytes, not file size, because reth's database is sparse. Turns the growth rate into a date, and alerts a week before it.
            </p>
            <div className="mt-5 flex items-end gap-1" aria-hidden="true">
              {[28, 34, 39, 45, 52, 58, 66, 73].map((h, i) => (
                <div key={i} className="w-full rounded-t bg-signal/70" style={{ height: h }} />
              ))}
              <div className="w-full rounded-t border border-dashed border-warn/70" style={{ height: 82 }} />
              <div className="w-full rounded-t border border-dashed border-warn/70" style={{ height: 92 }} />
            </div>
          </Tilt>
        </div>
        <div data-reveal>
          <Tilt className="h-full rounded-2xl border border-line bg-panel p-7">
            <KeyGlyph />
            <h3 className="mt-6 text-xl font-medium text-ink">Opened by the node's owner only</h3>
            <p className="mt-3 text-ink-muted">
              At install, the node's provider key signs one statement naming your wallet. From then on only that wallet can sign in. The provider key never touches a browser.
            </p>
            <div className="mt-5 rounded-lg bg-ground p-3 font-mono text-xs leading-relaxed text-ink-muted">
              Node <span className="text-ink">0xbD78…1880</span>
              <br />
              admin wallet <span className="text-ink">0xb45b…844e</span>
              <br />
              <span className="text-ok">authorised by the provider key</span>
            </div>
          </Tilt>
        </div>
      </Reveal>

      <Reveal className="mt-16 grid gap-x-10 gap-y-6 border-t border-line pt-10 sm:grid-cols-2 lg:grid-cols-3" stagger={0.05}>
        {[
          ["Verdict with the fix", "healthy, lagging, tunnel_down, no_agreement, low_gas… each with the command that resolves it."],
          ["Pool and earnings", "Offer, agreement and time left, calls served vs counted vs paid, from the marketplace entities."],
          ["Host and containers", "CPU, memory, I/O, network for the host and each node container; OOM kills; restart loops."],
          ["Chain view", "Head lag against the network, execution and consensus peers, finality, sync."],
          ["Alerts", "Telegram and PagerDuty with grouping, inhibition and silences. Nothing to self-host."],
          ["Encrypted vault", "Diagnostic bundles encrypted to an Arkiv engineer's Ethereum key, stored on Swarm."],
        ].map(([t, d]) => (
          <div key={t} data-reveal>
            <h3 className="font-medium text-ink">{t}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{d}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}

function HeartbeatGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="size-10" aria-hidden="true">
      <circle cx="24" cy="24" r="22" className="fill-none stroke-line" />
      <path d="M8 24h8l4-10 6 20 4-10h10" className="fill-none stroke-signal" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ForecastGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="size-10" aria-hidden="true">
      <circle cx="24" cy="24" r="22" className="fill-none stroke-line" />
      <path d="M10 34 L20 26 L28 29 L38 14" className="fill-none stroke-signal" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M31 14h7v7" className="fill-none stroke-signal" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function KeyGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="size-10" aria-hidden="true">
      <circle cx="24" cy="24" r="22" className="fill-none stroke-line" />
      <circle cx="19" cy="24" r="6" className="fill-none stroke-signal" strokeWidth="2" />
      <path d="M25 24h12m-4 0v5m-4-5v4" className="fill-none stroke-signal" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
