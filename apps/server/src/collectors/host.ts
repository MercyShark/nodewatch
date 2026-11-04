// Host metrics from /proc (mounted at HOST_PROC) and statfs on HOST_ROOT.
import { readFile, statfs } from "node:fs/promises";
import path from "node:path";
import type { Ctx } from "../context.js";
import type { HostSnapshot } from "../state.js";

export interface CpuTimes {
  idle: number;
  total: number;
  count: number;
}

export function parseProcStat(text: string): CpuTimes {
  const lines = text.split("\n");
  const cpu = lines.find((l) => l.startsWith("cpu "));
  if (!cpu) throw new Error("no cpu line in /proc/stat");
  const f = cpu.trim().split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal guest guest_nice; guest is already in user
  const idle = (f[3] ?? 0) + (f[4] ?? 0);
  const total = f.slice(0, 8).reduce((a, b) => a + (b || 0), 0);
  const count = lines.filter((l) => /^cpu\d+\s/.test(l)).length;
  return { idle, total, count };
}

export function parseMeminfo(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const m = /^(\w+(?:\(\w+\))?):\s+(\d+)(?:\s+kB)?/.exec(line);
    if (m) out[m[1]!] = Number(m[2]) * (line.includes("kB") ? 1024 : 1);
  }
  return out;
}

export function parseLoadavg(text: string): [number, number, number] {
  const [a, b, c] = text.trim().split(/\s+/).map(Number);
  return [a ?? 0, b ?? 0, c ?? 0];
}

const WHOLE_DISK = /^(nvme\d+n\d+|sd[a-z]+|xvd[a-z]+|vd[a-z]+|hd[a-z]+)$/;

export interface DiskCounters {
  readSectors: number;
  writeSectors: number;
  reads: number;
  writes: number;
}

export function parseDiskstats(text: string): DiskCounters {
  const acc: DiskCounters = { readSectors: 0, writeSectors: 0, reads: 0, writes: 0 };
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 14) continue;
    const name = f[2]!;
    if (!WHOLE_DISK.test(name)) continue;
    acc.reads += Number(f[3]);
    acc.readSectors += Number(f[5]);
    acc.writes += Number(f[7]);
    acc.writeSectors += Number(f[9]);
  }
  return acc;
}

const SKIP_IFACE = /^(lo|veth|docker|br-|virbr|tun|tap|cni|flannel|cali)/;

export function parseNetDev(text: string): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const line of text.split("\n").slice(2)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    if (SKIP_IFACE.test(name)) continue;
    const f = line.slice(idx + 1).trim().split(/\s+/).map(Number);
    rx += f[0] ?? 0;
    tx += f[8] ?? 0;
  }
  return { rx, tx };
}

export function parseVmstatOom(text: string): number | null {
  const m = /^oom_kill\s+(\d+)/m.exec(text);
  return m ? Number(m[1]) : null;
}

interface Prev {
  at: number;
  cpu: CpuTimes;
  disk: DiskCounters;
  net: { rx: number; tx: number };
}

export function createHostCollector(ctx: Ctx) {
  let prev: Prev | null = null;
  const proc = (p: string) => path.join(ctx.cfg.HOST_PROC, p);

  return async function collectHost(): Promise<void> {
    const now = Date.now();
    const [stat, mem, load, disk, net, vmstat] = await Promise.all([
      readFile(proc("stat"), "utf8"),
      readFile(proc("meminfo"), "utf8"),
      readFile(proc("loadavg"), "utf8"),
      readFile(proc("diskstats"), "utf8").catch(() => ""),
      readFile(proc("net/dev"), "utf8").catch(() => ""),
      readFile(proc("vmstat"), "utf8").catch(() => ""),
    ]);
    const cpu = parseProcStat(stat);
    const mi = parseMeminfo(mem);
    const [l1, l5, l15] = parseLoadavg(load);
    const dc = parseDiskstats(disk);
    const nc = parseNetDev(net);

    let fsTotal: number | null = null;
    let fsFree: number | null = null;
    try {
      const s = await statfs(ctx.cfg.HOST_ROOT);
      fsTotal = s.blocks * s.bsize;
      fsFree = s.bavail * s.bsize;
    } catch {
      /* leave null */
    }

    let cpuPct: number | null = null;
    let rd: number | null = null,
      wr: number | null = null,
      rio: number | null = null,
      wio: number | null = null,
      rx: number | null = null,
      tx: number | null = null;
    if (prev) {
      const dt = (now - prev.at) / 1000;
      const dTotal = cpu.total - prev.cpu.total;
      const dIdle = cpu.idle - prev.cpu.idle;
      cpuPct = dTotal > 0 ? Math.max(0, Math.min(100, (100 * (dTotal - dIdle)) / dTotal)) : null;
      if (dt > 0) {
        rd = Math.max(0, ((dc.readSectors - prev.disk.readSectors) * 512) / dt);
        wr = Math.max(0, ((dc.writeSectors - prev.disk.writeSectors) * 512) / dt);
        rio = Math.max(0, (dc.reads - prev.disk.reads) / dt);
        wio = Math.max(0, (dc.writes - prev.disk.writes) / dt);
        rx = Math.max(0, (nc.rx - prev.net.rx) / dt);
        tx = Math.max(0, (nc.tx - prev.net.tx) / dt);
      }
    }
    prev = { at: now, cpu, disk: dc, net: nc };

    const memTotal = mi.MemTotal ?? 0;
    const memAvailable = mi.MemAvailable ?? mi.MemFree ?? 0;
    const snap: HostSnapshot = {
      at: now,
      cpuCount: cpu.count,
      cpuPct,
      load1: l1,
      load5: l5,
      load15: l15,
      memTotal,
      memAvailable,
      memUsed: memTotal - memAvailable,
      swapTotal: mi.SwapTotal ?? 0,
      swapUsed: (mi.SwapTotal ?? 0) - (mi.SwapFree ?? 0),
      diskTotal: fsTotal,
      diskFree: fsFree,
      diskUsed: fsTotal !== null && fsFree !== null ? fsTotal - fsFree : null,
      diskReadBps: rd,
      diskWriteBps: wr,
      diskReadIops: rio,
      diskWriteIops: wio,
      netRxBps: rx,
      netTxBps: tx,
      kernelOomKills: parseVmstatOom(vmstat),
    };
    ctx.state.host = snap;
    const t = ctx.tsdb;
    t.record("host_cpu_pct", snap.cpuPct, {}, now);
    t.record("host_load1", snap.load1, {}, now);
    t.record("host_mem_used_bytes", snap.memUsed, {}, now);
    t.record("host_mem_total_bytes", snap.memTotal, {}, now);
    t.record("host_swap_used_bytes", snap.swapUsed, {}, now);
    t.record("host_disk_used_bytes", snap.diskUsed, {}, now);
    t.record("host_disk_free_bytes", snap.diskFree, {}, now);
    t.record("host_disk_read_bps", snap.diskReadBps, {}, now);
    t.record("host_disk_write_bps", snap.diskWriteBps, {}, now);
    t.record("host_disk_read_iops", snap.diskReadIops, {}, now);
    t.record("host_disk_write_iops", snap.diskWriteIops, {}, now);
    t.record("host_net_rx_bps", snap.netRxBps, {}, now);
    t.record("host_net_tx_bps", snap.netTxBps, {}, now);
  };
}
