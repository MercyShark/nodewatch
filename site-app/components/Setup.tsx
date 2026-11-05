"use client";

import { useEffect, useRef } from "react";
import { Server, Send, Siren } from "lucide-react";

const STEPS = [
  {
    icon: Server,
    title: "Endpoint",
    body: "Run one command on the node host. Nodewatch finds the node's RPC, consensus and tunnel on loopback.",
    code: "curl -fsSL …/install.sh | sudo bash -s -- 0xYourWallet",
  },
  {
    icon: Send,
    title: "Telegram bot",
    body: "Paste a bot token. The script finds your chat and sends the first message.",
    code: "sudo bash scripts/setup-telegram.sh",
  },
  {
    icon: Siren,
    title: "PagerDuty service",
    body: "Paste an Events API v2 key. Critical alerts open an incident and close it when the node recovers.",
    code: "sudo bash scripts/setup-pagerduty.sh",
  },
];

/** Three quiet steps. They reveal once when scrolled into view; nothing else on the page moves. */
export function Setup() {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.querySelectorAll(".step").forEach((s) => s.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.querySelectorAll(".step").forEach((s) => s.classList.add("is-in"));
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="setup" className="scroll-mt-14 bg-mist py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <p className="eyebrow">One-click setup</p>
        <h2 className="font-display mt-3 text-[clamp(1.9rem,4vw,2.75rem)] text-ink">Connect a node, attach Telegram, attach PagerDuty.</h2>
        <ol ref={list} className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="step r-one border border-soft bg-paper p-5">
              <div className="flex items-center gap-3">
                <span className="r-one inline-flex size-9 items-center justify-center bg-mist text-ink" aria-hidden>
                  <s.icon className="size-5" strokeWidth={1.5} />
                </span>
                <span className="font-mono text-xs text-ink/70">0{i + 1}</span>
              </div>
              <h3 className="mt-4 font-medium text-ink">{s.title}</h3>
              <p className="mt-2 text-[15px] text-ink/80">{s.body}</p>
              <pre className="r-one font-mono mt-4 whitespace-pre-wrap break-all bg-mist px-3 py-2 text-[13px] text-ink">
                <code>{s.code}</code>
              </pre>
            </li>
          ))}
        </ol>
        <div className="mt-10">
          <a href="https://github.com/MercyShark/nodewatch" className="btn-primary">
            Set up in one click
          </a>
          <p className="mt-3 text-sm text-ink/70">Needs a host that already runs the Arkiv node kit and Docker. Only your wallet can open the console.</p>
        </div>
      </div>
    </section>
  );
}
