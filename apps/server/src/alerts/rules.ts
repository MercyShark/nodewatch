// Alert rules are code; thresholds can be overridden through the `alertThresholds` setting.
import type { Severity } from "@nodewatch/shared";
import type { Ctx } from "../context.js";
import { getSetting } from "../db/index.js";

export const DEFAULT_THRESHOLDS = {
  diskWarnDays: 7,
  diskCritDays: 2,
  diskCritFreeBytes: 20e9,
  lagBlocks: 10,
  agreementExpiringSec: 2 * 3600,
  rpcErrorRate: 0.05,
  rpcMinRequests: 20,
  rpcP95Ms: 1000,
  hostCpuPct: 90,
  hostMemPct: 90,
  backupMaxAgeHours: 26,
};
export type Thresholds = typeof DEFAULT_THRESHOLDS;

export interface RuleInput {
  ctx: Ctx;
  th: Thresholds;
  now: number;
  /** RPC stats over the last 5 minutes. */
  rpc5m: { requests: number; errors: number; p95Ms: number | null };
}

/** `null` means "no data": the rule keeps its current state instead of resolving. */
export type RuleResult = { active: boolean; summary: string } | null;

export interface Rule {
  name: string;
  severity: Severity;
  forMs: number;
  /** Rules suppressed while this one fires. */
  inhibits?: string[];
  eval: (i: RuleInput) => RuleResult;
}

const off = (summary = ""): RuleResult => ({ active: false, summary });
const on = (summary: string): RuleResult => ({ active: true, summary });

export const RULES: Rule[] = [
  {
    name: "ContainerDown",
    severity: "critical",
    forMs: 60_000,
    inhibits: ["NodeLagging", "NoPeers", "TunnelDown", "RPCErrorRateHigh", "RPCLatencyHigh", "HeartbeatFailing", "AgreementExpiringSoon"],
    eval: ({ ctx }) => {
      const c = ctx.state.containers;
      if (!c.available) {
        const el = ctx.state.el;
        if (ctx.state.collectors.el?.lastError && (!el || Date.now() - el.at > 60_000)) return on("Execution RPC is not answering");
        return el ? off() : null;
      }
      const down = c.list.filter((x) => (x.service === "execution" || x.service === "consensus" || x.service === "tunnel") && !x.running);
      return down.length ? on(`Not running: ${down.map((d) => d.service).join(", ")}`) : off();
    },
  },
  {
    name: "OOMKilled",
    severity: "critical",
    forMs: 0,
    eval: ({ ctx }) => {
      if (!ctx.state.containers.available) return null;
      const o = ctx.state.containers.list.filter((x) => x.oomKilled);
      return o.length ? on(`OOM-killed: ${o.map((d) => d.service).join(", ")}`) : off();
    },
  },
  {
    name: "DiskDaysLeftCritical",
    severity: "critical",
    forMs: 0,
    inhibits: ["DiskDaysLeftLow"],
    eval: ({ ctx, th }) => {
      const k = ctx.state.kpis;
      const free = ctx.state.host?.diskFree ?? null;
      if (free !== null && free < th.diskCritFreeBytes) return on(`Only ${(free / 1e9).toFixed(1)} GB free on the root volume`);
      if (!k || k.diskDaysLeft === null) return free === null ? null : off();
      return k.diskDaysLeft < th.diskCritDays ? on(`Disk full in ${k.diskDaysLeft.toFixed(1)} days`) : off();
    },
  },
  {
    name: "DiskDaysLeftLow",
    severity: "warning",
    forMs: 0,
    eval: ({ ctx, th }) => {
      const d = ctx.state.kpis?.diskDaysLeft;
      if (d === null || d === undefined) return null;
      return d < th.diskWarnDays ? on(`Disk full in ${d.toFixed(1)} days`) : off();
    },
  },
  {
    name: "NodeLagging",
    severity: "warning",
    forMs: 5 * 60_000,
    eval: ({ ctx, th }) => {
      const lag = ctx.state.kpis?.headLag;
      if (lag === null || lag === undefined) return null; // failing reference RPC → no lag alarm
      return lag > th.lagBlocks ? on(`Head is ${lag} blocks behind the network`) : off();
    },
  },
  {
    name: "NoPeers",
    severity: "warning",
    forMs: 2 * 60_000,
    eval: ({ ctx }) => {
      const el = ctx.state.el?.peers;
      const cl = ctx.state.cl?.peers;
      if ((el === null || el === undefined) && (cl === null || cl === undefined)) return null;
      return el === 0 || cl === 0 ? on(`Peers: execution ${el ?? "?"}, consensus ${cl ?? "?"}`) : off();
    },
  },
  {
    name: "TunnelDown",
    severity: "critical",
    forMs: 2 * 60_000,
    eval: ({ ctx }) => {
      const tc = ctx.state.containers.list.find((c) => c.service === "tunnel");
      const t = ctx.state.tunnel;
      if (!tc && !t?.reachable) return off(); // tunnel profile off
      if (tc && !tc.running) return on("frpc tunnel container is not running");
      if (t && !t.running) return on("frpc reports the tunnel proxy is not running");
      return t ? off() : null;
    },
  },
  {
    name: "AgreementExpiringSoon",
    severity: "warning",
    forMs: 0,
    eval: ({ ctx, th }) => {
      const m = ctx.state.marketplace;
      if (!m || !ctx.cfg.PROVIDER_ADDRESS) return null;
      if (!m.agreement) return off();
      const head = ctx.state.el?.head ?? m.block ?? 0;
      const sec = Math.max(0, (m.agreement.expiresAtBlock - head) * 2);
      return sec < th.agreementExpiringSec ? on(`Agreement expires in ${Math.round(sec / 60)} minutes`) : off();
    },
  },
  {
    name: "HeartbeatFailing",
    severity: "warning",
    forMs: 0,
    eval: ({ ctx }) => {
      const h = ctx.state.heartbeat;
      if (!h.enabled) return off();
      return h.failuresInRow >= 3 ? on(`${h.failuresInRow} heartbeat writes failed in a row: ${h.reason ?? ""}`) : off();
    },
  },
  {
    name: "LowGas",
    severity: "warning",
    forMs: 0,
    eval: ({ ctx }) => {
      const b = ctx.state.balances;
      if (!b) return null;
      const th = ctx.cfg.LOW_GAS_THRESHOLD_GLM;
      const low: string[] = [];
      if (b.provider !== null && b.provider < th) low.push(`provider ${b.provider.toFixed(3)} tGLM`);
      if (ctx.state.heartbeat.enabled && b.heartbeat !== null && b.heartbeat < th) low.push(`heartbeat ${b.heartbeat.toFixed(3)} tGLM`);
      return low.length ? on(`Low balance: ${low.join(", ")}`) : off();
    },
  },
  {
    name: "BackupFailed",
    severity: "warning",
    forMs: 0,
    eval: ({ ctx, th, now }) => {
      const last = ctx.db.prepare("SELECT ok, created_at, error FROM backups ORDER BY created_at DESC LIMIT 1").get() as
        | { ok: number; created_at: number; error: string | null }
        | undefined;
      const lastOk = ctx.db.prepare("SELECT MAX(created_at) AS t FROM backups WHERE ok = 1").get() as { t: number | null };
      if (last && !last.ok) return on(`Last backup failed: ${last.error ?? "unknown error"}`);
      const maxAge = th.backupMaxAgeHours * 3600_000;
      const ref = lastOk.t ?? ctx.state.startedAt;
      return now - ref > maxAge ? on(`No successful backup in ${th.backupMaxAgeHours} h`) : off();
    },
  },
  {
    name: "RPCErrorRateHigh",
    severity: "warning",
    forMs: 5 * 60_000,
    eval: ({ rpc5m, th }) => {
      if (rpc5m.requests < th.rpcMinRequests) return off();
      const rate = rpc5m.errors / rpc5m.requests;
      return rate > th.rpcErrorRate ? on(`RPC error rate ${(rate * 100).toFixed(1)} % over 5 minutes`) : off();
    },
  },
  {
    name: "RPCLatencyHigh",
    severity: "warning",
    forMs: 0,
    eval: ({ rpc5m, th }) => {
      if (rpc5m.p95Ms === null) return off();
      return rpc5m.p95Ms > th.rpcP95Ms ? on(`RPC p95 latency ${Math.round(rpc5m.p95Ms)} ms`) : off();
    },
  },
  {
    name: "HostCPUHigh",
    severity: "warning",
    forMs: 10 * 60_000,
    eval: ({ ctx, th }) => {
      const c = ctx.state.host?.cpuPct;
      if (c === null || c === undefined) return null;
      return c > th.hostCpuPct ? on(`Host CPU at ${c.toFixed(0)} %`) : off();
    },
  },
  {
    name: "HostMemoryHigh",
    severity: "warning",
    forMs: 2 * 60_000,
    eval: ({ ctx, th }) => {
      const h = ctx.state.host;
      if (!h || !h.memTotal) return null;
      const pct = (100 * h.memUsed) / h.memTotal;
      return pct > th.hostMemPct ? on(`Host memory at ${pct.toFixed(0)} %`) : off();
    },
  },
];

export function thresholds(ctx: Ctx): Thresholds {
  return { ...DEFAULT_THRESHOLDS, ...getSetting<Partial<Thresholds>>(ctx.db, "alertThresholds", {}) };
}
