// Read-only dashboard routes (viewer and up).
import type {
  ChainResponse,
  Overview,
  PoolResponse,
  Range,
  ResourcesResponse,
  RpcResponse,
  Series,
  ServiceName,
} from "@nodewatch/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { zscoreAnomalies, type Anomaly } from "../analyzer/anomalies.js";
import { diskForecast } from "../analyzer/forecast.js";
import { thresholds, DEFAULT_THRESHOLDS } from "../alerts/rules.js";
import { requireRole } from "../auth/rbac.js";
import { poolAt } from "../collectors/marketplace.js";
import { publicConfig } from "../config.js";
import type { Ctx } from "../context.js";
import { setSetting, getSetting } from "../db/index.js";
import type { Services } from "../services.js";
import { isRange, RANGE_MS, Tsdb } from "../tsdb/index.js";
import { errMsg } from "../util/http.js";

const viewer = { preHandler: requireRole("viewer") };
const admin = { preHandler: requireRole("admin") };

function rangeOf(req: FastifyRequest, def: Range = "1h"): Range {
  const r = (req.query as { range?: string } | undefined)?.range;
  return isRange(r) ? r : def;
}

export function dataRoutes(app: FastifyInstance, ctx: Ctx, svc: Services): void {
  const { tsdb, state, cfg } = ctx;

  app.get("/api/overview", viewer, async (): Promise<Overview> => {
    const now = Date.now();
    return {
      node: {
        chainId: state.el?.chainId ?? null,
        network: cfg.ARKIV_NETWORK,
        elVersion: state.el?.version ?? null,
        clVersion: state.cl?.version ?? null,
        providerAddress: cfg.PROVIDER_ADDRESS ?? null,
        instanceName: cfg.INSTANCE_NAME ?? null,
      },
      verdict: state.verdict,
      kpis: state.kpis ?? svc.analyzer.kpis(now),
      containers: state.containers.list,
      heartbeat: state.heartbeat,
      recentAlerts: svc.alerts.history(10),
      updatedAt: now,
    };
  });

  app.get("/api/resources", viewer, async (req): Promise<ResourcesResponse & { anomalies: Anomaly[]; dockerAvailable: boolean; dockerReason: string | null }> => {
    const range = rangeOf(req);
    const s = (metric: string, labels: Record<string, string> = {}) => tsdb.series(metric, range, labels);
    const host = {
      cpuPct: s("host_cpu_pct"),
      memUsedBytes: s("host_mem_used_bytes"),
      diskUsedBytes: s("host_disk_used_bytes"),
      diskReadBps: s("host_disk_read_bps"),
      diskWriteBps: s("host_disk_write_bps"),
      netRxBps: s("host_net_rx_bps"),
      netTxBps: s("host_net_tx_bps"),
      load1: s("host_load1"),
    };
    const svcNames: ServiceName[] = ["execution", "consensus", "tunnel"];
    const containers = Object.fromEntries(
      svcNames.map((service) => [service, { cpuPct: s("container_cpu_pct", { service }), memBytes: s("container_mem_bytes", { service }) }]),
    ) as ResourcesResponse["containers"];
    return {
      range,
      host,
      containers,
      anomalies: zscoreAnomalies(host.cpuPct.points, "host_cpu_pct"),
      dockerAvailable: state.containers.available,
      dockerReason: state.containers.reason,
    };
  });

  app.get("/api/disk/forecast", viewer, async () => diskForecast(ctx));

  app.get("/api/chain", viewer, async (req): Promise<ChainResponse> => {
    const range = rangeOf(req);
    const lag = tsdb.series("chain_lag", range, {}, "max");
    return {
      range,
      head: tsdb.series("el_head", range, {}, "max"),
      reference: tsdb.series("ref_head", range, {}, "max"),
      lag,
      peersEl: tsdb.series("el_peers", range),
      peersCl: tsdb.series("cl_peers", range),
      syncing: state.kpis?.syncing ?? state.el?.syncing ?? null,
      syncDistance: state.cl?.syncDistance ?? null,
      finalizedEpoch: state.cl?.finalizedEpoch ?? null,
      justifiedEpoch: state.cl?.justifiedEpoch ?? null,
      catchUpBlocksPerMin: svc.analyzer.catchUpBlocksPerMin(),
    };
  });

  app.get("/api/pool", viewer, async (): Promise<PoolResponse & { updatedAt: number | null; error: string | null }> => {
    const m = state.marketplace;
    const err = state.collectors.marketplace?.lastError ?? null;
    if (!m) {
      return {
        providerAddress: cfg.PROVIDER_ADDRESS ?? null,
        lbAddress: cfg.LB_ADDRESS,
        currentBlock: state.el?.head ?? null,
        balanceGlm: state.balances?.provider ?? null,
        listing: null,
        offer: null,
        agreement: null,
        counter: null,
        receipts: [],
        updatedAt: null,
        error: err ?? "marketplace not read yet",
      };
    }
    const block = Math.max(state.el?.head ?? 0, m.block ?? 0) || null;
    const { at, block: _b, ...rest } = poolAt(m, block);
    return { ...rest, currentBlock: block, balanceGlm: state.balances?.provider ?? null, updatedAt: at, error: err };
  });

  app.get("/api/rpc", viewer, async (req): Promise<RpcResponse & { anomalies: Anomaly[]; shapes: { shapeId: string; count: number; avgMs: number; maxMs: number; errors: number }[] }> => {
    const range = rangeOf(req);
    const span = RANGE_MS[range];
    const methods = tsdb.labelSets("rpc_requests", span).map((l) => l.method ?? "unknown");
    const avg = (pts: { v: number }[]) => (pts.length ? pts.reduce((a, p) => a + p.v, 0) / pts.length : null);
    const rows = methods.map((method) => {
      const labels = { method };
      const p50 = avg(tsdb.query({ metric: "rpc_latency_p50_ms", labels, range }));
      const p95pts = tsdb.query({ metric: "rpc_latency_p95_ms", labels, range, agg: "max" });
      return {
        method,
        requests: Math.round(tsdb.sum("rpc_requests", labels, span)),
        errors: Math.round(tsdb.sum("rpc_errors", labels, span)),
        p50Ms: p50 === null ? null : Math.round(p50 * 10) / 10,
        p95Ms: p95pts.length ? Math.round(Math.max(...p95pts.map((p) => p.v)) * 10) / 10 : null,
      };
    });
    rows.sort((a, b) => b.requests - a.requests);
    // rpc_requests is a count per 15 s window: x4 gives requests/min.
    const step = Tsdb.stepFor(range);
    const requestsPerMin: Series[] = rows.map((r) => ({
      metric: "rpc_requests_per_min",
      labels: { method: r.method },
      points: tsdb.query({ metric: "rpc_requests", labels: { method: r.method }, range, stepMs: step }).map((p) => ({ t: p.t, v: Math.round(p.v * 4 * 100) / 100 })),
    }));
    const anomalies = rows.flatMap((r) =>
      zscoreAnomalies(tsdb.query({ metric: "rpc_latency_p95_ms", labels: { method: r.method }, range }), "rpc_latency_p95_ms", { method: r.method }),
    );
    const shapes = [...svc.rpcStats.shapes.entries()]
      .map(([shapeId, s]) => ({ shapeId, count: s.count, avgMs: Math.round((s.totalMs / s.count) * 10) / 10, maxMs: Math.round(s.maxMs), errors: s.errors }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
    return { range, proxyMode: cfg.PROXY_MODE, methods: rows, requestsPerMin, anomalies, shapes };
  });

  app.get("/api/fleet", viewer, async (_req, reply) => {
    try {
      return await svc.fleet.read();
    } catch (err) {
      return reply.code(502).send({ error: `fleet query failed: ${errMsg(err)}`, currentBlock: null, nodes: [] });
    }
  });

  app.post("/api/fleet/pins", admin, async (req, reply) => {
    const b = z.object({ creator: z.string().regex(/^0x[0-9a-fA-F]{40}$/), pinned: z.boolean().default(true) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "creator must be an address" });
    const cur = new Set(getSetting<string[]>(ctx.db, "fleetPinned", []));
    const a = b.data.creator.toLowerCase();
    if (b.data.pinned) cur.add(a);
    else cur.delete(a);
    setSetting(ctx.db, "fleetPinned", [...cur]);
    return { pinned: [...cur] };
  });

  app.get("/api/settings", viewer, async (req) => ({
    config: publicConfig(cfg),
    adminAddresses: req.user?.role === "admin" ? cfg.ADMIN_ADDRESSES : [],
    viewerAddresses: req.user?.role === "admin" ? cfg.VIEWER_ADDRESSES : [],
    thresholds: thresholds(ctx),
    defaults: DEFAULT_THRESHOLDS,
    heartbeat: { enabled: svc.heartbeat.enabled, writer: svc.heartbeat.writer, reason: svc.heartbeat.disabledReason() },
    collectors: state.collectors,
    agentVersion: cfg.AGENT_VERSION,
  }));

  app.put("/api/settings/thresholds", admin, async (req, reply) => {
    const shape = Object.fromEntries(Object.keys(DEFAULT_THRESHOLDS).map((k) => [k, z.number().finite().nonnegative().optional()]));
    const b = z.object(shape).strict().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join("; ") });
    const merged = { ...getSetting<Record<string, number>>(ctx.db, "alertThresholds", {}), ...b.data };
    setSetting(ctx.db, "alertThresholds", merged);
    return { thresholds: thresholds(ctx) };
  });
}
