"use client";

import { useState } from "react";
import { Reveal } from "./Reveal";
import { Magnetic } from "./Magnetic";

const CMD = "curl -fsSL https://raw.githubusercontent.com/rishabh-onerx/nodewatch/main/scripts/install.sh | sudo bash -s -- 0xYourAdminWallet";

const STEPS = [
  ["Reads the provider address", "from the node kit's keystore. No password needed for that."],
  ["Signs the authorisation", "asks the keystore password once, signs inside the kit's own image, keystore read-only. Nothing is stored."],
  ["Creates a heartbeat key", "a separate hot key for the on-chain heartbeat. Fund it later from the faucet."],
  ["Builds and starts", "writes .env with mode 600, starts the one container, prints your URL."],
];

export function Install() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard refused: the command is selectable text */
    }
  };

  return (
    <section id="install" className="mx-auto max-w-6xl px-5 sm:px-8">
      <Reveal>
        <h2 data-reveal className="font-display text-4xl leading-tight text-ink sm:text-5xl" style={{ textWrap: "balance" }}>
          One command on the node host.
        </h2>
        <p data-reveal className="mt-5 max-w-xl text-ink-muted">
          Needs a host that already runs the Arkiv community node kit, Docker, and the wallet address you will sign in with. Four minutes on a fresh host.
        </p>
      </Reveal>

      <Reveal className="mt-10" y={16}>
        <div data-reveal className="rounded-2xl border border-line bg-panel p-1">
          <div className="flex items-center justify-between px-4 py-2.5 text-xs text-ink-muted">
            <span className="font-mono">as root, on the node host</span>
            <button type="button" onClick={copy} className="min-h-9 rounded-full border border-line px-3 font-medium text-ink transition-colors hover:border-signal/60">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-ground px-5 py-5 font-mono text-[13.5px] leading-relaxed text-ink sm:text-sm">
            <code>
              <span className="text-ink-muted select-none">$ </span>curl -fsSL https://raw.githubusercontent.com/rishabh-onerx/nodewatch/main/scripts/install.sh \{"\n"}
              {"    "}| sudo bash -s -- <span className="text-signal">0xYourAdminWallet</span>
            </code>
          </pre>
        </div>
      </Reveal>

      <Reveal className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4" stagger={0.1}>
        {STEPS.map(([t, d], i) => (
          <div key={t} data-reveal className="relative pl-5">
            <span className="absolute left-0 top-0 h-full w-px bg-line" aria-hidden="true">
              <span className="absolute -left-[3px] top-1 size-[7px] rounded-full bg-signal" />
            </span>
            <h3 className="font-medium text-ink">{t}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{d}</p>
            <span className="sr-only">Step {i + 1}</span>
          </div>
        ))}
      </Reveal>

      <Reveal className="mt-14 flex flex-wrap items-center gap-3">
        <span data-reveal>
          <Magnetic href="https://github.com/rishabh-onerx/nodewatch" className="bg-signal text-ground hover:bg-[#7fdcff]">
            Read the source on GitHub
          </Magnetic>
        </span>
        <span data-reveal>
          <Magnetic href="https://github.com/rishabh-onerx/nodewatch/blob/main/site/index.html" className="border border-line text-ink hover:border-signal/60" strength={0.25}>
            Full setup guide
          </Magnetic>
        </span>
      </Reveal>
    </section>
  );
}
