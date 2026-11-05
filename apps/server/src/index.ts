// Boot: config, db, collectors, analyzer, alerts, heartbeats, HTTP API + UI, proxy listener.
import { Analyzer } from "./analyzer/index.js";
import { recordDiskSample } from "./analyzer/forecast.js";
import { AlertEngine } from "./alerts/engine.js";
import { FleetReader } from "./arkiv/fleet.js";
import { HeartbeatWriter } from "./arkiv/heartbeat.js";
import { Sessions, sessionSecret } from "./auth/session.js";
import { Backups } from "./backup/index.js";
import { Bench } from "./bench/runner.js";
import { createBalancesCollector, createClCollector, createElCollector, createReferenceCollector, createTunnelCollector } from "./collectors/chain.js";
import { createContainerCollectors } from "./collectors/containers.js";
import { createHostCollector } from "./collectors/host.js";
import { createMarketplaceCollector } from "./collectors/marketplace.js";
import { Scheduler, type Job } from "./collectors/scheduler.js";
import { createVolumesCollector } from "./collectors/volumes.js";
import { loadConfig, publicConfig } from "./config.js";
import type { Ctx } from "./context.js";
import { openDb } from "./db/index.js";
import { AllowlistedDocker } from "./docker/client.js";
import { log } from "./log.js";
import { registerStateGauges } from "./metrics.js";
import { RpcStats, percentile, startProxy } from "./proxy/rpcProxy.js";
import { buildApp } from "./server.js";
import type { Services } from "./services.js";
import { verifyAuthorization } from "./auth/nodeAuth.js";
import { Bus, initialState } from "./state.js";
import { Vault } from "./swarm/vault.js";
import { Tsdb } from "./tsdb/index.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  log.level = cfg.LOG_LEVEL;
  if (cfg.AUTH_DEV_BYPASS) log.warn("AUTH_DEV_BYPASS is on: every request is treated as admin (loopback only)");
  if (cfg.nodeAuth) {
    // Refuse to start on a bad authorisation: a wrong signature must never silently fall back to "anyone".
    await verifyAuthorization(cfg.nodeAuth, cfg.ARKIV_CHAIN_ID, cfg.PROVIDER_ADDRESS);
    log.info({ provider: cfg.nodeAuth.provider, admin: cfg.nodeAuth.admin }, "node authorization verified: admin wallet bound to the provider");
  } else if (!cfg.ADMIN_ADDRESSES.length && !cfg.ADMIN_PASSWORD_HASH && !cfg.AUTH_DEV_BYPASS) {
    log.warn("no admin configured: set NODE_AUTHORIZATION (scripts/install.sh), ADMIN_ADDRESSES or ADMIN_PASSWORD_HASH");
  }
  const db = openDb(cfg.DATA_DIR);
  const ctx: Ctx = {
    cfg,
    db,
    tsdb: new Tsdb(db),
    state: initialState(),
    bus: new Bus(),
    docker: new AllowlistedDocker(cfg.DOCKER_SOCKET, cfg.NODE_COMPOSE_PROJECT, cfg.BENCH_SANDBOX_IMAGE),
    log,
  };
  ctx.bus.setMaxListeners(100);
  registerStateGauges(ctx);

  const rpcStats = new RpcStats();
  const containers = createContainerCollectors(ctx);
  const heartbeat = new HeartbeatWriter(ctx);
  const analyzer = new Analyzer(ctx, containers.recentRestarts, () => {
    const n = rpcStats.requestsLastMinute();
    return n > 0 || cfg.PROXY_MODE === "inline" ? n : null;
  });
  const rpc5m = () => {
    const now = Date.now();
    let requests = 0;
    let errors = 0;
    const p95s: number[] = [];
    for (const l of ctx.tsdb.labelSets("rpc_requests", 5 * 60_000, now)) {
      requests += ctx.tsdb.sum("rpc_requests", l, 5 * 60_000, now);
      errors += ctx.tsdb.sum("rpc_errors", l, 5 * 60_000, now);
      p95s.push(...ctx.tsdb.values("rpc_latency_p95_ms", l, 5 * 60_000, now));
    }
    return { requests, errors, p95Ms: percentile(p95s.sort((a, b) => a - b), 95) };
  };
  const alerts = new AlertEngine(ctx, rpc5m);
  const vault = new Vault(ctx);
  const backups = new Backups(ctx, vault);
  const bench = new Bench(ctx, vault);
  const svc: Services = {
    sessions: new Sessions(db, sessionSecret(cfg), cfg.secureCookies),
    analyzer,
    alerts,
    rpcStats,
    fleet: new FleetReader(ctx, heartbeat.writer),
    heartbeat,
    vault,
    backups,
    bench,
  };

  const collectVolumes = createVolumesCollector(ctx);
  const jobs: Record<string, Job> = {
    host: { name: "host", intervalMs: 15_000, timeoutMs: 5_000, run: createHostCollector(ctx) },
    docker: { name: "docker", intervalMs: 10_000, timeoutMs: 9_000, run: containers.inspectAll },
    containers: { name: "containers", intervalMs: 15_000, timeoutMs: 12_000, run: containers.statsAll },
    el: { name: "el", intervalMs: 10_000, timeoutMs: 6_000, run: createElCollector(ctx) },
    cl: { name: "cl", intervalMs: 10_000, timeoutMs: 6_000, run: createClCollector(ctx) },
    tunnel: { name: "tunnel", intervalMs: 15_000, timeoutMs: 6_000, run: createTunnelCollector(ctx) },
    reference: { name: "reference", intervalMs: 60_000, timeoutMs: 10_000, run: createReferenceCollector(ctx) },
    marketplace: { name: "marketplace", intervalMs: 5 * 60_000, timeoutMs: 30_000, run: createMarketplaceCollector(ctx) },
    balances: { name: "balances", intervalMs: 5 * 60_000, timeoutMs: 10_000, run: createBalancesCollector(ctx, () => heartbeat.writer) },
    volumes: {
      name: "volumes",
      intervalMs: 5 * 60_000,
      timeoutMs: 150_000,
      initialDelayMs: 3_000,
      run: async () => {
        try {
          await collectVolumes();
        } finally {
          recordDiskSample(ctx);
        }
      },
    },
  };
  const sched = new Scheduler(ctx);
  // First round before the API opens, so the first page load has data.
  await Promise.all(["host", "docker", "el", "cl", "tunnel", "reference", "marketplace", "balances"].map((n) => sched.runNow(jobs[n]!)));
  analyzer.run();
  for (const [name, job] of Object.entries(jobs)) {
    if (name === "volumes") sched.add(job);
    else sched.add({ ...job, initialDelayMs: job.intervalMs });
  }
  sched.add({ name: "analyzer", intervalMs: 10_000, timeoutMs: 5_000, initialDelayMs: 2_000, run: async () => analyzer.run() });
  sched.add({ name: "tsdb-flush", intervalMs: 15_000, timeoutMs: 10_000, run: async () => void ctx.tsdb.flush() });
  sched.add({ name: "rpc-flush", intervalMs: 15_000, timeoutMs: 5_000, run: async () => rpcStats.flush(ctx) });
  sched.add({ name: "rollup", intervalMs: 5 * 60_000, timeoutMs: 60_000, initialDelayMs: 30_000, run: async () => void ctx.tsdb.rollupAndRetain() });
  sched.add({ name: "alerts", intervalMs: 15_000, timeoutMs: 10_000, initialDelayMs: 5_000, run: async () => alerts.evaluate() });
  if (heartbeat.enabled) {
    sched.add({ name: "heartbeat", intervalMs: cfg.HEARTBEAT_INTERVAL_SEC * 1000, timeoutMs: 60_000, initialDelayMs: 5_000, run: () => heartbeat.beat() });
  } else {
    log.info({ reason: heartbeat.disabledReason() }, "heartbeats disabled");
  }
  backups.start();

  const app = await buildApp(ctx, svc);
  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  log.info({ config: publicConfig(cfg) }, `nodewatch listening on http://${cfg.HOST}:${cfg.PORT}`);
  const proxy = startProxy(ctx, rpcStats);

  let stopping = false;
  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ sig }, "shutting down");
    sched.stop();
    backups.stop();
    try {
      ctx.tsdb.flush();
      proxy.close();
      await app.close();
    } finally {
      db.close();
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

process.on("unhandledRejection", (err) => log.error({ err: (err as Error)?.message ?? String(err) }, "unhandled rejection"));
process.on("uncaughtException", (err) => log.error({ err: err.message, stack: err.stack }, "uncaught exception"));

main().catch((err: Error) => {
  log.fatal({ err: err.message }, "failed to start");
  process.exit(1);
});
