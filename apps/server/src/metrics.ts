// Optional Prometheus exposition at GET /metrics (for operators who already run a scraper).
import client from "prom-client";
import type { Ctx } from "./context.js";

export const registry = new client.Registry();

export const rpcRequests = new client.Counter({
  name: "nodewatch_rpc_requests_total",
  help: "JSON-RPC requests seen by the proxy listener",
  labelNames: ["method", "outcome"] as const,
  registers: [registry],
});

export const rpcDuration = new client.Histogram({
  name: "nodewatch_rpc_duration_seconds",
  help: "JSON-RPC request latency through the proxy listener",
  labelNames: ["method"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const notifierSends = new client.Counter({
  name: "nodewatch_notifier_sends_total",
  help: "Alert notifications sent",
  labelNames: ["channel", "ok"] as const,
  registers: [registry],
});

export const rpcSlow = new client.Counter({
  name: "nodewatch_rpc_slow_requests_total",
  help: "Requests over the slow (slowRequestMs) and critical (callRequestMs) thresholds",
  labelNames: ["method", "level"] as const,
  registers: [registry],
});

export const rpcErrors = new client.Counter({
  name: "nodewatch_rpc_errors_total",
  help: "Failed JSON-RPC requests by the node's error code (http / upstream when there was no JSON-RPC error)",
  labelNames: ["method", "code"] as const,
  registers: [registry],
});

/** Every series carries the node's name so one Prometheus can hold many nodes; plus process metrics and an info gauge. */
export function setNodeIdentity(node: string, revision: string, image: string): void {
  registry.setDefaultLabels({ node });
  client.collectDefaultMetrics({ register: registry, prefix: "nodewatch_process_" });
  new client.Gauge({
    name: "nodewatch_info",
    help: "Build information (always 1)",
    labelNames: ["revision", "image"] as const,
    registers: [registry],
    collect() {
      this.set({ revision, image }, 1);
    },
  });
}

export function registerInlineGauge(read: () => boolean): void {
  new client.Gauge({
    name: "nodewatch_inline_mode",
    help: "1 when the tunnel sends the pool's traffic through the Nodewatch proxy",
    registers: [registry],
    collect() {
      this.set(read() ? 1 : 0);
    },
  });
}

export const heartbeatWrites = new client.Counter({
  name: "nodewatch_heartbeat_writes_total",
  help: "Heartbeat transactions sent to Arkiv",
  labelNames: ["ok"] as const,
  registers: [registry],
});

/** Gauges read from live state on each scrape. */
export function registerStateGauges(ctx: Ctx): void {
  const g = (name: string, help: string, read: () => number | null | undefined, labelNames: string[] = []) =>
    new client.Gauge({
      name,
      help,
      labelNames,
      registers: [registry],
      collect() {
        const v = read();
        if (v !== null && v !== undefined && Number.isFinite(v)) this.set(v);
        else this.reset();
      },
    });
  const s = ctx.state;
  g("nodewatch_el_head", "Execution head block", () => s.el?.head);
  g("nodewatch_reference_head", "Reference RPC head block", () => s.reference?.head);
  g("nodewatch_head_lag_blocks", "Head lag vs the reference RPC", () => s.kpis?.headLag);
  g("nodewatch_el_peers", "Execution peers", () => s.el?.peers);
  g("nodewatch_cl_peers", "Consensus peers", () => s.cl?.peers);
  g("nodewatch_host_cpu_percent", "Host CPU %", () => s.host?.cpuPct);
  g("nodewatch_host_mem_used_bytes", "Host memory used", () => s.host?.memUsed);
  g("nodewatch_host_disk_free_bytes", "Free bytes on the root volume", () => s.host?.diskFree);
  g("nodewatch_disk_days_left", "Days until the disk is full", () => s.kpis?.diskDaysLeft);
  g("nodewatch_healthy", "1 when the verdict is healthy", () => (s.verdict.code === "healthy" ? 1 : 0));
  g("nodewatch_heartbeat_failures_in_row", "Consecutive failed heartbeat writes", () => s.heartbeat.failuresInRow);
  new client.Gauge({
    name: "nodewatch_container_up",
    help: "1 when the node container is running",
    labelNames: ["service"],
    registers: [registry],
    collect() {
      this.reset();
      for (const c of s.containers.list) this.set({ service: c.service }, c.running ? 1 : 0);
    },
  });
}
