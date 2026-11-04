// In-memory live state (latest collector outputs) plus the event bus behind /api/stream.
import { EventEmitter } from "node:events";
import type {
  AlertEvent,
  ContainerState,
  HeartbeatState,
  Kpis,
  PoolResponse,
  ServiceName,
  StreamEvent,
  Verdict,
} from "@nodewatch/shared";

export interface HostSnapshot {
  at: number;
  cpuCount: number;
  cpuPct: number | null;
  load1: number;
  load5: number;
  load15: number;
  memTotal: number;
  memUsed: number;
  memAvailable: number;
  swapTotal: number;
  swapUsed: number;
  diskTotal: number | null;
  diskFree: number | null;
  diskUsed: number | null;
  diskReadBps: number | null;
  diskWriteBps: number | null;
  diskReadIops: number | null;
  diskWriteIops: number | null;
  netRxBps: number | null;
  netTxBps: number | null;
  kernelOomKills: number | null;
}

export interface ElSnapshot {
  at: number;
  chainId: number | null;
  head: number | null;
  syncing: boolean | null;
  syncCurrent: number | null;
  syncHighest: number | null;
  peers: number | null;
  version: string | null;
}

export interface ClSnapshot {
  at: number;
  isSyncing: boolean | null;
  isOptimistic: boolean | null;
  elOffline: boolean | null;
  headSlot: number | null;
  syncDistance: number | null;
  peers: number | null;
  version: string | null;
  healthStatus: number | null;
  finalizedEpoch: number | null;
  justifiedEpoch: number | null;
}

export interface TunnelSnapshot {
  at: number;
  reachable: boolean;
  running: boolean;
  proxies: { name: string; status: string; err: string; localAddr: string; remoteAddr: string }[];
}

export interface ContainersSnapshot {
  at: number;
  available: boolean;
  reason: string | null;
  list: ContainerState[];
}

export type MarketplaceSnapshot = Omit<PoolResponse, "currentBlock" | "balanceGlm"> & { at: number; block: number | null };

export interface LiveState {
  startedAt: number;
  host: HostSnapshot | null;
  containers: ContainersSnapshot;
  volumes: { at: number; el: number | null; cl: number | null } | null;
  el: ElSnapshot | null;
  cl: ClSnapshot | null;
  tunnel: TunnelSnapshot | null;
  reference: { at: number; head: number } | null;
  marketplace: MarketplaceSnapshot | null;
  balances: { at: number; provider: number | null; heartbeat: number | null } | null;
  verdict: Verdict;
  kpis: Kpis | null;
  heartbeat: HeartbeatState;
  /** Head samples used to compute the catch-up rate. */
  collectors: Record<string, { lastRun: number | null; lastSuccess: number | null; lastError: string | null; lastErrorAt: number | null }>;
}

export const SERVICES: ServiceName[] = ["execution", "consensus", "tunnel"];

export function initialState(): LiveState {
  return {
    startedAt: Date.now(),
    host: null,
    containers: { at: 0, available: false, reason: "not collected yet", list: [] },
    volumes: null,
    el: null,
    cl: null,
    tunnel: null,
    reference: null,
    marketplace: null,
    balances: null,
    verdict: {
      code: "unknown",
      severity: "info",
      title: "Collecting data from the node.",
      detail: "Nodewatch has just started and has not finished its first round of checks.",
      fix: null,
      since: Date.now(),
    },
    kpis: null,
    heartbeat: {
      enabled: false,
      writer: null,
      entityKey: null,
      lastTxHash: null,
      lastBlock: null,
      lastAt: null,
      expiresAtBlock: null,
      failuresInRow: 0,
      reason: "not started",
    },
    collectors: {},
  };
}

export class Bus extends EventEmitter {
  publish(ev: StreamEvent): void {
    this.emit("stream", ev);
  }
  alert(ev: AlertEvent): void {
    this.publish({ event: "alert", data: ev });
  }
}
