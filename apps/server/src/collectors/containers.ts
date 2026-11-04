// Docker inspect (state, restarts, health, OOM) and stats (CPU, memory, block IO, network)
// for the node stack's containers, via the allowlisted client.
import type { ContainerState, ServiceName } from "@nodewatch/shared";
import type Docker from "dockerode";
import type { Ctx } from "../context.js";
import type { NodeContainerRef } from "../docker/client.js";
import { errMsg } from "../util/http.js";

const ERROR_LINE = /\b(error|err|fatal|panic|crit|critical)\b/i;
const ANSI = /\x1b\[[0-9;]*m/g;

export function cpuPercent(s: Docker.ContainerStats): number | null {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
  const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  if (!(sysDelta > 0) || cpuDelta < 0) return null;
  return (cpuDelta / sysDelta) * cpus * 100;
}

export function memBytes(s: Docker.ContainerStats): number | null {
  const m = s.memory_stats;
  if (!m || typeof m.usage !== "number") return null;
  const st = (m.stats ?? {}) as Record<string, number>;
  const cache = st.inactive_file ?? st.total_inactive_file ?? st.cache ?? 0;
  return Math.max(0, m.usage - cache);
}

interface Track {
  restarts: number;
  restartTimes: number[];
  lastErrorLine: string | null;
  logsAt: number;
  prevBlk: { r: number; w: number; at: number } | null;
  prevNet: { rx: number; tx: number; at: number } | null;
}

export function createContainerCollectors(ctx: Ctx) {
  const tracks = new Map<ServiceName, Track>();
  let refs: NodeContainerRef[] = [];
  const stats = new Map<ServiceName, { cpuPct: number | null; memBytes: number | null }>();

  const track = (s: ServiceName): Track => {
    let t = tracks.get(s);
    if (!t) {
      t = { restarts: -1, restartTimes: [], lastErrorLine: null, logsAt: 0, prevBlk: null, prevNet: null };
      tracks.set(s, t);
    }
    return t;
  };

  async function inspectAll(): Promise<void> {
    const avail = ctx.docker.available();
    if (!avail.ok) {
      ctx.state.containers = { at: Date.now(), available: false, reason: avail.reason, list: [] };
      return;
    }
    try {
      refs = await ctx.docker.listNodeContainers();
    } catch (err) {
      ctx.state.containers = { at: Date.now(), available: false, reason: `Docker API: ${errMsg(err)}`, list: [] };
      throw err;
    }
    const now = Date.now();
    if (refs.length === 0) {
      // Not even one container of the project: this Docker host is not the node's (e.g. local dev).
      // Report "unavailable" rather than a false container_down; the EL/CL checks still catch a dead node.
      ctx.state.containers = {
        at: now,
        available: false,
        reason: `no containers of compose project "${ctx.cfg.NODE_COMPOSE_PROJECT}" on this Docker host`,
        list: [],
      };
      return;
    }
    const list: ContainerState[] = [];
    const wanted: ServiceName[] = ["execution", "consensus", "tunnel"];
    for (const service of wanted) {
      const ref = refs.find((r) => r.service === service);
      if (!ref) {
        if (service === "tunnel") continue; // tunnel profile off: not an error
        list.push({
          service,
          name: `${ctx.cfg.NODE_COMPOSE_PROJECT}-${service}-1`,
          image: "",
          running: false,
          health: "none",
          restarts: 0,
          oomKilled: false,
          startedAt: null,
          cpuPct: null,
          memBytes: null,
          lastErrorLine: "container not found",
        });
        continue;
      }
      const info = await ctx.docker.inspect(ref.id);
      const t = track(service);
      const rc = info.RestartCount ?? 0;
      if (t.restarts >= 0 && rc > t.restarts) for (let i = 0; i < rc - t.restarts; i++) t.restartTimes.push(now);
      t.restarts = rc;
      t.restartTimes = t.restartTimes.filter((x) => now - x < 15 * 60_000);
      if (now - t.logsAt > 60_000) {
        t.logsAt = now;
        try {
          const lines = await ctx.docker.logs(ref.id, 200);
          const errLine = [...lines].reverse().find((l) => ERROR_LINE.test(l));
          t.lastErrorLine = errLine ? errLine.replace(ANSI, "").slice(0, 300) : null;
        } catch {
          /* keep previous */
        }
      }
      const h = info.State?.Health?.Status;
      const st = stats.get(service);
      list.push({
        service,
        name: ref.name,
        image: info.Config?.Image ?? ref.image,
        running: !!info.State?.Running && !info.State?.Restarting,
        health: h === "healthy" || h === "unhealthy" || h === "starting" ? h : "none",
        restarts: rc,
        oomKilled: !!info.State?.OOMKilled,
        startedAt: info.State?.StartedAt ?? null,
        cpuPct: st?.cpuPct ?? null,
        memBytes: st?.memBytes ?? null,
        lastErrorLine: t.lastErrorLine ?? (info.State?.Error ? info.State.Error : null),
      });
      ctx.tsdb.record("container_up", info.State?.Running ? 1 : 0, { service }, now);
      ctx.tsdb.record("container_restarts", rc, { service }, now);
    }
    const prevJson = JSON.stringify(ctx.state.containers.list.map((c) => [c.service, c.running, c.health, c.restarts, c.oomKilled]));
    ctx.state.containers = { at: now, available: true, reason: null, list };
    const nextJson = JSON.stringify(list.map((c) => [c.service, c.running, c.health, c.restarts, c.oomKilled]));
    if (prevJson !== nextJson) ctx.bus.publish({ event: "containers", data: list });
  }

  async function statsAll(): Promise<void> {
    if (!ctx.docker.available().ok || refs.length === 0) return;
    const now = Date.now();
    await Promise.all(
      refs
        .filter((r) => r.state === "running")
        .map(async (ref) => {
          try {
            const s = await ctx.docker.stats(ref.id);
            const cpu = cpuPercent(s);
            const mem = memBytes(s);
            stats.set(ref.service, { cpuPct: cpu, memBytes: mem });
            const labels = { service: ref.service };
            ctx.tsdb.record("container_cpu_pct", cpu, labels, now);
            ctx.tsdb.record("container_mem_bytes", mem, labels, now);
            const t = track(ref.service);
            const blk = s.blkio_stats?.io_service_bytes_recursive ?? [];
            const r = blk.filter((b) => /read/i.test(b.op)).reduce((a, b) => a + b.value, 0);
            const w = blk.filter((b) => /write/i.test(b.op)).reduce((a, b) => a + b.value, 0);
            if (t.prevBlk && now > t.prevBlk.at) {
              const dt = (now - t.prevBlk.at) / 1000;
              ctx.tsdb.record("container_blk_read_bps", Math.max(0, (r - t.prevBlk.r) / dt), labels, now);
              ctx.tsdb.record("container_blk_write_bps", Math.max(0, (w - t.prevBlk.w) / dt), labels, now);
            }
            t.prevBlk = { r, w, at: now };
            const nets = Object.values(s.networks ?? {});
            const rx = nets.reduce((a, n) => a + (n.rx_bytes ?? 0), 0);
            const tx = nets.reduce((a, n) => a + (n.tx_bytes ?? 0), 0);
            if (nets.length && t.prevNet && now > t.prevNet.at) {
              const dt = (now - t.prevNet.at) / 1000;
              ctx.tsdb.record("container_net_rx_bps", Math.max(0, (rx - t.prevNet.rx) / dt), labels, now);
              ctx.tsdb.record("container_net_tx_bps", Math.max(0, (tx - t.prevNet.tx) / dt), labels, now);
            }
            if (nets.length) t.prevNet = { rx, tx, at: now };
            const c = ctx.state.containers.list.find((x) => x.service === ref.service);
            if (c) {
              c.cpuPct = cpu;
              c.memBytes = mem;
            }
          } catch {
            /* one container failing does not stop the others */
          }
        }),
    );
  }

  /** Restarts within the last 15 minutes (restart-loop detection). */
  function recentRestarts(service: ServiceName): number {
    return tracks.get(service)?.restartTimes.length ?? 0;
  }

  return { inspectAll, statsAll, recentRestarts };
}
