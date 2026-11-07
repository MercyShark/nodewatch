"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, LayoutDashboard, Wallet } from "lucide-react";
import { DEMO } from "@/lib/site";

function Cred({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-navy/10 py-2 first:border-t-0">
      <dt className="text-sm text-navy/70">{k}</dt>
      <dd className="font-mono text-sm font-bold break-all text-navy select-all">{v}</dd>
    </div>
  );
}

function DemoCard({ title, Icon, href, children, delay }: { title: string; Icon: typeof Wallet; href: string; children: ReactNode; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col rounded-3xl border border-navy/15 bg-card/70 p-6 sm:p-8"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-navy text-white">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <h3 className="text-xl font-bold tracking-[-0.02em] text-navy">{title}</h3>
      </div>
      <p className="mt-4 font-mono text-sm break-all text-navy/80">{href}</p>
      <div className="mt-4 flex-1">{children}</div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-navy px-6 font-medium text-white transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0"
      >
        Open {title}
        <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
      </a>
    </motion.div>
  );
}

export function LiveDemo() {
  return (
    <section id="demo" className="scroll-mt-20 pt-8 sm:pt-12">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <p className="font-mono text-xs tracking-[0.18em] text-navy/80">LIVE DEMO · TODAY ONLY</p>
        <h2 className="mt-3 max-w-3xl text-[clamp(2rem,4.6vw,3.5rem)] leading-[1.05] font-bold tracking-[-0.03em] text-navy" style={{ textWrap: "balance" }}>
          See it running on a real Arkiv node.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-navy/80">
          Both logins are open for the pitch only and will be turned off afterwards.
        </p>
        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2">
          <DemoCard title="Nodewatch dashboard" Icon={Wallet} href={DEMO.console} delay={0}>
            <p className="text-[15px] leading-relaxed text-navy/80">
              Sign in with <strong className="text-navy">any wallet</strong>, such as MetaMask. You only sign a message: no transaction, no gas. Access is
              read-only.
            </p>
          </DemoCard>
          <DemoCard title="Fleet Grafana" Icon={LayoutDashboard} href={DEMO.grafana} delay={0.06}>
            <dl className="rounded-2xl border border-navy/15 bg-dusk/45 px-4 py-1">
              <Cred k="Username" v={DEMO.grafanaUser} />
              <Cred k="Password" v={DEMO.grafanaPassword} />
            </dl>
          </DemoCard>
        </div>
      </div>
    </section>
  );
}
