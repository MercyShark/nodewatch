// Runs after the collectors: KPIs, verdict (with history), catch-up rate. Publishes SSE events.
import type { Kpis, Verdict } from "@nodewatch/shared";
import type { Ctx } from "../context.js";
import { diskForecast } from "./forecast.js";
import { EXPECTED_CHAIN_ID, evaluateVerdict } from "./verdict.js";

export class Analyzer {
  private lastOom: number | null = null;
  private oomAt: number[] = [];
  private forecastCache: { at: number; days: number | null } = { at: 0, days: null };

  constructor(
    private readonly ctx: Ctx,
    private readonly recentRestarts: (s: "execution" | "consensus" | "tunnel") => number,
    private readonly rpcRequestsPerMin: () => number | null,
    private readonly proxyInline: () => boolean = () => false,
  ) {
    const last = ctx.db.prepare("SELECT ts, code, severity, title, detail, fix FROM verdicts ORDER BY ts DESC LIMIT 1").get() as
      | { ts: number; code: Verdict["code"]; severity: Verdict["severity"]; title: string; detail: string; fix: string | null }
      | undefined;
    if (last) ctx.state.verdict = { code: last.code, severity: last.severity, title: last.title, detail: last.detail, fix: last.fix, since: last.ts };
  }

  headLag(now = Date.now()): number | null {
    const { el, reference } = this.ctx.state;
    if (!el?.head || !reference || now - reference.at > 5 * 60_000) return null;
    return Math.max(0, reference.head + Math.floor((now - reference.at) / 2000) - el.head);
  }

  referenceHead(now = Date.now()): number | null {
    const r = this.ctx.state.reference;
    if (!r || now - r.at > 5 * 60_000) return null;
    return r.head + Math.floor((now - r.at) / 2000);
  }

  /** Blocks per minute by which the node closes its lag (head rate minus the 30 blocks/min network rate). */
  catchUpBlocksPerMin(now = Date.now()): number | null {
    const heads = this.ctx.tsdb.values("el_head", {}, 10 * 60_000, now);
    if (heads.length < 4) return null;
    const minutes = (heads.length - 1) * (10 / 60); // samples every 10 s
    const rate = (heads[heads.length - 1]! - heads[0]!) / minutes;
    return Math.round((rate - 30) * 10) / 10;
  }

  diskDaysLeft(): number | null {
    const now = Date.now();
    if (now - this.forecastCache.at > 60_000) this.forecastCache = { at: now, days: diskForecast(this.ctx, now).daysToFull };
    return this.forecastCache.days;
  }

  kpis(now = Date.now()): Kpis {
    const s = this.ctx.state;
    const vol = s.volumes;
    return {
      headBlock: s.el?.head ?? null,
      referenceHead: this.referenceHead(now),
      headLag: this.headLag(now),
      peersEl: s.el?.peers ?? null,
      peersCl: s.cl?.peers ?? null,
      syncing: s.el?.syncing === null || s.el === null ? (s.cl?.isSyncing ?? null) : s.el.syncing || !!s.cl?.isSyncing,
      diskDaysLeft: this.diskDaysLeft(),
      diskFreeBytes: s.host?.diskFree ?? null,
      diskTotalBytes: s.host?.diskTotal ?? null,
      chainDataBytes: vol && (vol.el !== null || vol.cl !== null) ? (vol.el ?? 0) + (vol.cl ?? 0) : null,
      cpuPct: s.host?.cpuPct === null || s.host?.cpuPct === undefined ? null : Math.round(s.host.cpuPct * 10) / 10,
      memUsedBytes: s.host?.memUsed ?? null,
      memTotalBytes: s.host?.memTotal ?? null,
      providerBalanceGlm: s.balances?.provider ?? null,
      heartbeatBalanceGlm: s.balances?.heartbeat ?? null,
      rpcRequestsPerMin: this.rpcRequestsPerMin(),
    };
  }

  run(now = Date.now()): void {
    const s = this.ctx.state;
    const cfg = this.ctx.cfg;
    // Kernel OOM kill counter (from /proc/vmstat)
    const oom = s.host?.kernelOomKills ?? null;
    if (oom !== null) {
      if (this.lastOom !== null && oom > this.lastOom) this.oomAt.push(now);
      this.lastOom = oom;
    }
    this.oomAt = this.oomAt.filter((t) => now - t < 3600_000);

    const kpis = this.kpis(now);
    const lowGas: { who: string; balance: number }[] = [];
    const th = cfg.LOW_GAS_THRESHOLD_GLM;
    if (s.balances?.provider != null && s.balances.provider < th) lowGas.push({ who: "provider", balance: s.balances.provider });
    if (s.heartbeat.enabled && s.balances?.heartbeat != null && s.balances.heartbeat < th) lowGas.push({ who: "heartbeat", balance: s.balances.heartbeat });

    const tunnelContainer = s.containers.list.find((c) => c.service === "tunnel");
    const elFresh = s.el && now - s.el.at < 60_000 ? s.el : null;
    const clFresh = s.cl && now - s.cl.at < 60_000 ? s.cl : null;
    const m = s.marketplace;
    const verdictInput = {
      kitDir: "/opt/arkiv-community-node",
      dockerAvailable: s.containers.available,
      containers: s.containers.list,
      recentRestarts: this.recentRestarts,
      kernelOomRecent: this.oomAt.length > 0,
      diskFree: s.host?.diskFree ?? null,
      diskTotal: s.host?.diskTotal ?? null,
      elReachable: !!elFresh && elFresh.head !== null,
      chainId: elFresh?.chainId ?? null,
      expectedChainId: cfg.ARKIV_CHAIN_ID || EXPECTED_CHAIN_ID,
      elSyncing: elFresh?.syncing ?? null,
      headLag: kpis.headLag,
      catchUpBlocksPerMin: this.catchUpBlocksPerMin(now),
      elPeers: elFresh?.peers ?? null,
      clReachable: !!clFresh,
      clElOffline: clFresh?.elOffline ?? null,
      clPeers: clFresh?.peers ?? null,
      tunnelProfileOn: !!tunnelContainer || (s.tunnel?.reachable ?? false),
      tunnelRunning: tunnelContainer && !tunnelContainer.running ? false : s.tunnel ? s.tunnel.running : null,
      marketplaceKnown: !!m && now - m.at < 30 * 60_000,
      providerConfigured: !!cfg.PROVIDER_ADDRESS,
      agreementLive: !!m?.agreement && (m.agreement.expiresAtBlock ?? 0) > (s.el?.head ?? m.block ?? 0),
      lowGas,
      lowGasThreshold: th,
      rpcRequestsPerMin: kpis.rpcRequestsPerMin,
      proxyInline: this.proxyInline(),
    };
    // Before the first EL sample there is nothing to judge.
    if (!s.el && !s.collectors.el?.lastError) return;
    const next = evaluateVerdict(verdictInput);
    const prev = s.verdict;
    const changed = prev.code !== next.code || prev.title !== next.title;
    const verdict: Verdict = { ...next, since: prev.code === next.code ? prev.since : now };
    s.verdict = verdict;
    if (prev.code !== next.code) {
      this.ctx.db
        .prepare("INSERT INTO verdicts(ts, code, severity, title, detail, fix) VALUES (?, ?, ?, ?, ?, ?)")
        .run(now, verdict.code, verdict.severity, verdict.title, verdict.detail, verdict.fix);
      this.ctx.db.prepare("DELETE FROM verdicts WHERE ts < ?").run(now - 30 * 86_400_000);
      this.ctx.log.info({ code: verdict.code }, "verdict changed");
    }
    if (changed) this.ctx.bus.publish({ event: "verdict", data: verdict });
    s.kpis = kpis;
    this.ctx.bus.publish({ event: "kpis", data: kpis });
    this.ctx.tsdb.record("disk_days_left", kpis.diskDaysLeft, {}, now);
  }
}
