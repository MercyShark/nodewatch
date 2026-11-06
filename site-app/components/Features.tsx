"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Activity, BadgeCheck, BellRing, Eraser, HeartPulse, Radio, RotateCcw, Timer } from "lucide-react";
import { BentoCard, BentoGrid } from "@/components/magicui/bento-grid";
import { cn } from "@/lib/utils";

// ---- small visuals, one per card: a glance at the real UI, not a paragraph ----

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-navy/15 bg-dusk/45 p-4", className)}>{children}</div>;
}

function MetricsVisual() {
  const pts = [14, 18, 15, 22, 19, 26, 24, 31, 28, 35, 33, 40, 38, 44];
  const d = pts.map((y, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * 300} ${60 - y}`).join(" ");
  const kpis: [string, string][] = [["Head lag", "0 blk"], ["Peers", "13 / 10"], ["Disk full in", "182 d"], ["CPU", "14 %"]];
  return (
    <Panel className="h-full">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map(([k, v]) => (
          <div key={k}>
            <p className="text-xs text-navy/70">{k}</p>
            <p className="font-mono text-lg font-bold text-navy">{v}</p>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 300 64" className="mt-4 h-20 w-full" preserveAspectRatio="none" aria-hidden="true">
        <path d={`${d} L300 64 L0 64 Z`} fill="#0d1a33" opacity="0.1" />
        <path d={d} fill="none" stroke="#0d1a33" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d="M300 16 L300 16" stroke="#0d1a33" />
      </svg>
    </Panel>
  );
}

function AlertsVisual() {
  return (
    <div className="flex flex-col gap-2.5">
      <Panel className="p-3">
        <p className="font-mono text-[11px] text-navy/70">Telegram · Nodewatch bot</p>
        <p className="mt-1 text-sm text-navy">
          <span className="font-bold">CRITICAL</span> ContainerDown: tunnel is not running
        </p>
      </Panel>
      <Panel className="flex items-center justify-between gap-2 p-3">
        <span className="font-mono text-[11px] text-navy/70">PagerDuty</span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-navy">
          <span className="rounded-full bg-navy px-2 py-0.5 text-white">Triggered</span>→
          <span className="rounded-full border border-navy/30 px-2 py-0.5">Resolved</span>
        </span>
      </Panel>
    </div>
  );
}

function RestartVisual() {
  return (
    <Panel className="relative overflow-hidden pl-5">
      <span className="absolute inset-y-0 left-0 w-1.5 bg-navy" aria-hidden="true" />
      <p className="font-mono text-[11px] text-navy/70">tunnel_down · 20 s ago</p>
      <p className="mt-1 text-sm font-medium text-navy">The pool cannot reach your node.</p>
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 text-xs font-medium text-white">
        <RotateCcw className="size-3.5" aria-hidden="true" /> Fix it: restart tunnel
      </span>
    </Panel>
  );
}

function QueriesVisual() {
  const rows: [string, number, boolean][] = [["shape #20", 92, true], ["shape #11", 71, false], ["shape #26", 54, false], ["shape #16", 38, false]];
  return (
    <Panel className="h-full">
      <div className="flex items-center justify-between font-mono text-[11px] text-navy/70">
        <span>p95 as data grows</span>
        <span>slow line 250 ms</span>
      </div>
      <ul className="mt-3 flex flex-col gap-2.5">
        {rows.map(([n, w, slow]) => (
          <li key={n} className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
            <span className="font-mono text-xs text-navy">{n}</span>
            <span className="relative h-3 rounded-full bg-navy/10">
              <span className={cn("absolute inset-y-0 left-0 rounded-full", slow ? "bg-navy" : "bg-navy/45")} style={{ width: `${w}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LiveQueriesVisual() {
  const rows: [string, string, string, number][] = [
    ["14:08:21", "arkiv_query", "$owner = addr(0xbd78…) AND kind = str('rpc.offer')", 12],
    ["14:08:21", "eth_getLogs", '{"fromBlock":"0x46000","toBlock":"0x46400"}', 96],
    ["14:08:20", "arkiv_query", "$expiresAt > u64(400003)", 802],
    ["14:08:15", "eth_blockNumber", "[]", 2],
  ];
  return (
    <Panel className="h-full">
      <div className="flex items-center justify-between font-mono text-[11px] text-navy/70">
        <span>live · pool traffic</span>
        <span>over 750 ms → Telegram</span>
      </div>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-xs">
        {rows.map(([t, m, q, ms]) => (
          <li key={t + m + ms} className="grid grid-cols-[3.6rem_6.2rem_1fr_3.6rem] items-center gap-2">
            <span className="text-navy/60">{t}</span>
            <span className="text-navy">{m}</span>
            <span className="truncate text-navy/70">{q}</span>
            <span className={cn("text-right font-bold", ms >= 750 ? "text-navy" : "text-navy/70")}>{ms} ms</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CleanupVisual() {
  return (
    <Panel className="flex flex-col gap-2 text-sm">
      <p className="flex justify-between text-navy">
        <span>Build cache</span>
        <span className="font-mono font-bold">5.1 GB</span>
      </p>
      <p className="flex justify-between text-navy">
        <span>Untagged images</span>
        <span className="font-mono font-bold">0.6 GB</span>
      </p>
      <span className="mt-1 inline-flex w-fit items-center rounded-full bg-navy px-3 py-1.5 text-xs font-medium text-white">Free 5.7 GB</span>
    </Panel>
  );
}

function HeartbeatVisual() {
  return (
    <Panel className="flex items-center gap-4">
      <svg viewBox="0 0 48 48" className="size-14 -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="none" stroke="#0d1a33" strokeOpacity="0.15" strokeWidth="5" />
        <circle cx="24" cy="24" r="20" fill="none" stroke="#0d1a33" strokeWidth="5" strokeLinecap="round" strokeDasharray="125.6" strokeDashoffset="34" />
      </svg>
      <div>
        <p className="font-mono text-lg font-bold text-navy">1:52</p>
        <p className="text-xs text-navy/70">until this heartbeat expires</p>
      </div>
    </Panel>
  );
}

function ProfileVisual() {
  return (
    <Panel>
      <p className="font-bold text-navy">Mumbai-01</p>
      <p className="mt-0.5 text-xs text-navy/70">India · 0xbD78…1880</p>
      <span className="mt-3 inline-flex items-center gap-1 rounded-full border border-navy/30 px-2.5 py-1 text-xs font-medium text-navy">
        <BadgeCheck className="size-3.5" aria-hidden="true" /> Signed by the provider key
      </span>
    </Panel>
  );
}

const CARDS: { name: string; description: string; Icon: typeof Activity; visual: ReactNode; className: string; tag?: string }[] = [
  {
    name: "Live queries",
    description: "Every request the pool sends your node, timed one by one, with the actual query and the node's answer. Anything slow goes to Telegram as it happens.",
    Icon: Radio,
    visual: <LiveQueriesVisual />,
    className: "md:col-span-2",
    tag: "new",
  },
  {
    name: "Live metrics",
    description: "CPU, memory, disk, sync and peers for the server and every container. Plus the day your disk will fill.",
    Icon: Activity,
    visual: <MetricsVisual />,
    className: "md:col-span-2",
  },
  {
    name: "Telegram and PagerDuty",
    description: "Every alert and every slow request on Telegram. Critical ones open a PagerDuty incident that closes itself when the node recovers.",
    Icon: BellRing,
    visual: <AlertsVisual />,
    className: "md:col-span-1",
  },
  {
    name: "One-click restart",
    description: "When a container stops, Nodewatch names it, says why the node left the pool, and restarts it in one click.",
    Icon: RotateCcw,
    visual: <RestartVisual />,
    className: "md:col-span-1",
  },
  {
    name: "Slow query finder",
    description: "Times Arkiv queries as your data grows and shows which ones will turn slow, before your users feel it.",
    Icon: Timer,
    visual: <QueriesVisual />,
    className: "md:col-span-2",
  },
  {
    name: "Disk cleanup",
    description: "Frees Docker leftovers in one click. Chain data is never touched.",
    Icon: Eraser,
    visual: <CleanupVisual />,
    className: "md:col-span-1",
  },
  {
    name: "Heartbeat on Arkiv",
    description: "A self-expiring heartbeat on-chain. If the server dies, others see it within two minutes.",
    Icon: HeartPulse,
    visual: <HeartbeatVisual />,
    className: "md:col-span-1",
    tag: "on-chain",
  },
  {
    name: "Signed node profile",
    description: "Name your node on Arkiv, signed by your provider key, so nobody can fake it.",
    Icon: BadgeCheck,
    visual: <ProfileVisual />,
    className: "md:col-span-1",
    tag: "on-chain",
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <p className="font-mono text-xs tracking-[0.18em] text-navy/80">WHAT IT DOES</p>
        <h2 className="mt-3 max-w-3xl text-[clamp(2rem,4.6vw,3.5rem)] leading-[1.05] font-bold tracking-[-0.03em] text-navy" style={{ textWrap: "balance" }}>
          Everything your node needs, watched for you.
        </h2>
        <BentoGrid className="mt-12">
          {CARDS.map((c, i) => (
            <motion.div
              key={c.name}
              className={cn("flex", c.className)}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.06, ease: [0.16, 1, 0.3, 1] }}
            >
              <BentoCard name={c.name} description={c.description} Icon={c.Icon} visual={c.visual} tag={c.tag} className="w-full" />
            </motion.div>
          ))}
        </BentoGrid>
      </div>
    </section>
  );
}
