"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { RUN_COMMAND } from "@/lib/site";

const STEPS: [string, string][] = [
  ["Run it on the node host", "Put your server's IP, your wallet address and your Telegram and PagerDuty keys in the --env lines. Leave out any key you don't use."],
  ["Say hi to your bot", "Send /start to your Telegram bot. Nodewatch links the chat and replies."],
  ["Open port 8000 and sign in", "Allow TCP 8000 in your firewall, open http://YOUR_SERVER_IP:8000, and sign in with the wallet you named. Nobody else can get in: there is no password, only that wallet's signature."],
];

export function Install() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(RUN_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the text stays selectable */
    }
  };
  return (
    <section id="install" className="scroll-mt-20 pb-24 sm:pb-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="overflow-hidden rounded-[32px] bg-navy text-[#e8f0fb]">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-10 p-6 sm:p-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-12 lg:p-14">
            <div>
              <p className="font-mono text-xs tracking-[0.18em] text-dusk">INSTALL</p>
              <h2 className="mt-3 text-[clamp(2rem,4.4vw,3.25rem)] leading-[1.05] font-bold tracking-[-0.03em] text-white" style={{ textWrap: "balance" }}>
                One command. No scripts.
              </h2>
              <ol className="mt-8 flex flex-col gap-5">
                {STEPS.map(([t, d], i) => (
                  <li key={t} className="grid grid-cols-[2rem_1fr] gap-3">
                    <span className="grid size-8 place-items-center rounded-full border border-dusk/50 font-mono text-sm text-dusk">{i + 1}</span>
                    <div>
                      <p className="font-medium text-white">{t}</p>
                      <p className="mt-0.5 text-[15px] leading-relaxed text-[#c9d8ee]">{d}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="min-w-0">
              <div className="rounded-2xl border border-white/10 bg-[#081226]">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                  <span className="font-mono text-xs text-dusk">bash</span>
                  <button
                    type="button"
                    onClick={copy}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
                    aria-label="Copy the docker run command"
                  >
                    {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-[#e8f0fb] sm:p-5 sm:text-sm">
                  <code>{RUN_COMMAND}</code>
                </pre>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-[#c9d8ee]">
                Nodewatch creates its own small wallet for heartbeats on Arkiv. The dashboard shows its address: send it a little tGLM from the faucet.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
