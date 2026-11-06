// Realistic fixtures (docs/ENVIRONMENT.md values). Mock mode only.
import type {
  UpdateState,
  CleanupPreview,
  CleanupResult,
  NodeProfileFields,
  NodeProfileState,
  AlertEvent,
  AlertsResponse,
  AutopilotState,
  BackupsResponse,
  BenchCatalog,
  BenchResult,
  BenchRun,
  Bundle,
  ChainResponse,
  ContainerState,
  DiskForecast,
  FleetResponse,
  HeartbeatState,
  Kpis,
  Overview,
  PoolResponse,
  Range,
  ResourcesResponse,
  RpcResponse,
  LiveQueriesResponse,
  QueryShapeRow,
  RecentRequest,
  SlowRequest,
  Series,
  SeriesPoint,
  Verdict,
} from "@nodewatch/shared";
import { BENCH_DATASETS, BENCH_FAMILIES, BENCH_SHAPE_NOTES, SLOW_K, SLOW_P95_MS } from "@nodewatch/shared";
import { mockStore, type Scenario } from "./state";

export const CHAIN_ID = 7794095;
export const PROVIDER = "0xbD78B7d668282b8950774aB013706237b05a1880";
export const LB = "0xCA4B166EE155Cb2816Dc25f94Dc1fD102a26c997";
export const SETTLE = "0x411E31d7eBbfd636Af234954db5f598Cd80a878C";
export const HEARTBEAT_WRITER = "0x5E1f3a7C29b04De6aB11c09c8E7b5A2f6D3c9B10";
const GBy = 1e9;
export const DISK_TOTAL = 968 * GBy;
export const MEM_TOTAL = 64 * GBy;
const T0 = Date.now();
const HEAD0 = 207_800;

export const headAt = (t = Date.now()) => HEAD0 + Math.floor((t - T0) / 2000);

// Deterministic pseudo-noise so charts look stable between refetches.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function noise(seed: number, t: number): number {
  const x = Math.sin(seed * 0.0001 + t * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
function smooth(seed: number, t: number, period: number): number {
  const a = Math.floor(t / period);
  const f = t / period - a;
  const u = f * f * (3 - 2 * f);
  return noise(seed, a) * (1 - u) + noise(seed, a + 1) * u;
}

export const RANGE_STEP: Record<Range, number> = {
  "1h": 15_000,
  "6h": 60_000,
  "24h": 5 * 60_000,
  "7d": 30 * 60_000,
  "30d": 2 * 3600_000,
};
const RANGE_MS: Record<Range, number> = {
  "1h": 3600_000,
  "6h": 6 * 3600_000,
  "24h": 86400_000,
  "7d": 7 * 86400_000,
  "30d": 30 * 86400_000,
};

function gen(metric: string, range: Range, f: (t: number, seed: number) => number, labels: Record<string, string> = {}): Series {
  const step = RANGE_STEP[range];
  const end = Math.floor(Date.now() / step) * step;
  const start = end - RANGE_MS[range];
  const seed = hash(metric + JSON.stringify(labels));
  const points: SeriesPoint[] = [];
  for (let t = start; t <= end; t += step) points.push({ t, v: f(t, seed) });
  return { metric, labels, points };
}

const wave = (t: number, seed: number, base: number, amp: number, period = 600_000) =>
  base + amp * (smooth(seed, t / period, 1) - 0.5) * 2 + amp * 0.35 * (noise(seed, t / 15_000) - 0.5);

const scen = (): Scenario => mockStore.get().scenario;

export function resources(range: Range): ResourcesResponse {
  const s = scen();
  const cpuBase = s === "lagging" ? 58 : 23;
  const diskUsedNow = s === "disk_low" ? DISK_TOTAL - 30 * GBy : 41.6 * GBy;
  const diskRate = (s === "disk_low" ? 11 : 0.9) * GBy / 86400_000;
  return {
    range,
    host: {
      cpuPct: gen("host_cpu_pct", range, (t, sd) => Math.max(1, Math.min(100, wave(t, sd, cpuBase, 9)))),
      memUsedBytes: gen("host_mem_used", range, (t, sd) => wave(t, sd, 18.4 * GBy, 1.2 * GBy, 3600_000)),
      diskUsedBytes: gen("host_disk_used", range, (t) => diskUsedNow - (Date.now() - t) * diskRate),
      diskReadBps: gen("host_disk_read", range, (t, sd) => Math.max(0, wave(t, sd, 1.1e6, 0.9e6, 120_000))),
      diskWriteBps: gen("host_disk_write", range, (t, sd) => Math.max(0, wave(t, sd, 4.2e6, 2.5e6, 120_000))),
      netRxBps: gen("host_net_rx", range, (t, sd) => Math.max(0, wave(t, sd, 610e3, 260e3, 300_000))),
      netTxBps: gen("host_net_tx", range, (t, sd) => Math.max(0, wave(t, sd, 455e3, 200e3, 300_000))),
      load1: gen("host_load1", range, (t, sd) => Math.max(0.1, wave(t, sd, cpuBase / 12, 0.7))),
    },
    containers: {
      execution: {
        cpuPct: gen("c_cpu", range, (t, sd) => Math.max(0.5, wave(t, sd, cpuBase * 0.62, 6)), { service: "execution" }),
        memBytes: gen("c_mem", range, (t, sd) => wave(t, sd, 6.2 * GBy, 0.4 * GBy, 1800_000), { service: "execution" }),
      },
      consensus: {
        cpuPct: gen("c_cpu", range, (t, sd) => Math.max(0.2, wave(t, sd, 5.1, 2.5)), { service: "consensus" }),
        memBytes: gen("c_mem", range, (t, sd) => wave(t, sd, 2.9 * GBy, 0.2 * GBy, 1800_000), { service: "consensus" }),
      },
      tunnel: {
        cpuPct: gen("c_cpu", range, (t, sd) => Math.max(0, wave(t, sd, 0.25, 0.15)), { service: "tunnel" }),
        memBytes: gen("c_mem", range, (t, sd) => wave(t, sd, 18e6, 2e6), { service: "tunnel" }),
      },
    },
  };
}

export function diskForecast(): DiskForecast {
  const s = scen();
  const low = s === "disk_low";
  const ratePerDay = (low ? 11.2 : 0.92) * GBy;
  const chainNow = low ? 46.1 * GBy : 7.7 * GBy;
  const free = low ? 30 * GBy : 926.4 * GBy;
  const now = Date.now();
  const samples: SeriesPoint[] = [];
  for (let i = 288; i >= 0; i--) {
    const t = now - i * 5 * 60_000;
    const jitter = (noise(7, t / 300_000) - 0.5) * 0.01 * GBy;
    samples.push({ t, v: chainNow - (i * 5 * 60_000 * ratePerDay) / 86400_000 + jitter });
  }
  const daysToFull = free / ratePerDay;
  const fullAt = now + daysToFull * 86400_000;
  const projection: SeriesPoint[] = [
    { t: now, v: chainNow },
    { t: fullAt, v: chainNow + free },
  ];
  return {
    samples,
    projection,
    freeBytes: free,
    totalBytes: DISK_TOTAL,
    volumes: { el: low ? 38.4 * GBy : 5.3 * GBy, cl: low ? 7.7 * GBy : 2.4 * GBy },
    ratePerDay6h: ratePerDay * 1.06,
    ratePerDay24h: ratePerDay,
    daysToFull,
    thresholds: { warnDays: 7, critDays: 2 },
  };
}

export function verdict(): Verdict {
  const since = Date.now() - 42 * 60_000;
  switch (scen()) {
    case "lagging":
      return {
        code: "lagging",
        severity: "warning",
        title: "Your node is 184 blocks (about 6 minutes) behind the network.",
        detail:
          "Execution is catching up at 41 blocks/min, so it should be back in rotation in about 4 minutes. The load balancer skips nodes more than 10 blocks behind.",
        fix: "docker compose -p arkiv-community-node logs --tail 200 execution",
        since,
      };
    case "tunnel_down":
      return {
        code: "tunnel_down",
        severity: "critical",
        title: "The tunnel to the load balancer is down, so the pool cannot reach your node.",
        detail: "frpc is not running (exit code 1, 3 restarts in 10 min). Last log line: login to server failed: i/o timeout.",
        fix: "docker compose -p arkiv-community-node logs tunnel && ./marketplace.sh start-tunnel",
        action: { kind: "restart_service", service: "tunnel" },
        since,
      };
    case "disk_low":
      return {
        code: "disk_full",
        severity: "warning",
        title: "The disk fills in about 2.7 days at the current rate (11.2 GB/day).",
        detail: "30 GB free of 968 GB. Chain data grew 11 GB in the last 24 h. Grow the gp3 root volume before it fills.",
        fix: "terraform apply -var root_volume_gib=1500 && sudo growpart /dev/nvme0n1 1 && sudo resize2fs /dev/nvme0n1p1",
        action: { kind: "disk_cleanup" },
        since,
      };
    case "container_down":
      return {
        code: "container_down",
        severity: "critical",
        title: "The consensus client is restart-looping, so the node cannot follow the chain.",
        detail: "arkiv-community-node-consensus-1 restarted 6 times in 5 minutes. Last error: Failed to start beacon node: database lock held.",
        fix: "docker compose -p arkiv-community-node logs --tail 200 consensus && ./setup.sh",
        since,
      };
    case "no_agreement":
      return {
        code: "no_agreement",
        severity: "warning",
        title: "No live agreement exists for your provider, so the pool sends no traffic.",
        detail: "Your offer expired 34 minutes ago and the load balancer has not created a new agreement.",
        fix: "./marketplace.sh post-offer",
        action: { kind: "autopilot_run" },
        since,
      };
    default:
      return {
        code: "healthy",
        severity: "ok",
        title: "Your node is healthy and in rotation.",
        detail: "In sync with the network, 13 execution and 10 consensus peers, tunnel up, agreement live for another 58 minutes.",
        fix: null,
        since: Date.now() - 6 * 3600_000,
      };
  }
}

let kpiTick = 0;
export function kpis(): Kpis {
  const s = scen();
  kpiTick++;
  const head = headAt();
  const lag = s === "lagging" ? 184 - (kpiTick % 20) : s === "container_down" ? 37 + kpiTick : kpiTick % 7 === 0 ? 1 : 0;
  const f = resources("1h");
  const last = (x: Series) => x.points[x.points.length - 1]?.v ?? 0;
  const disk = diskForecast();
  return {
    headBlock: head - lag,
    referenceHead: head,
    headLag: lag,
    peersEl: s === "container_down" ? 13 : 12 + (kpiTick % 3),
    peersCl: s === "container_down" ? 0 : 10,
    syncing: s === "lagging",
    diskDaysLeft: disk.daysToFull,
    diskFreeBytes: disk.freeBytes,
    diskTotalBytes: DISK_TOTAL,
    chainDataBytes: (disk.volumes.el ?? 0) + (disk.volumes.cl ?? 0),
    cpuPct: last(f.host.cpuPct) + (Math.random() - 0.5) * 3,
    memUsedBytes: last(f.host.memUsedBytes),
    memTotalBytes: MEM_TOTAL,
    providerBalanceGlm: 4.8213,
    heartbeatBalanceGlm: 0.7462,
    rpcRequestsPerMin: 36 + Math.round(Math.random() * 10),
  };
}

export function containers(): ContainerState[] {
  const s = scen();
  const started = new Date(T0 - 3 * 86400_000 - 4 * 3600_000).toISOString();
  return [
    {
      service: "execution",
      name: "arkiv-community-node-execution-1",
      image: "ghcr.io/arkiv-network/arkiv-reth:v1.0.0",
      running: true,
      health: "healthy",
      restarts: 0,
      oomKilled: false,
      startedAt: started,
      cpuPct: 14.2 + Math.random() * 3,
      memBytes: 6.2 * GBy,
      lastErrorLine: null,
    },
    {
      service: "consensus",
      name: "arkiv-community-node-consensus-1",
      image: "sigp/lighthouse:v8.3.1",
      running: s !== "container_down",
      health: s === "container_down" ? "unhealthy" : "healthy",
      restarts: s === "container_down" ? 6 : 0,
      oomKilled: false,
      startedAt: s === "container_down" ? new Date(Date.now() - 40_000).toISOString() : started,
      cpuPct: s === "container_down" ? null : 5.1 + Math.random(),
      memBytes: s === "container_down" ? null : 2.9 * GBy,
      lastErrorLine: s === "container_down" ? "CRIT Failed to start beacon node: database lock held" : null,
    },
    {
      service: "tunnel",
      name: "arkiv-community-node-tunnel-1",
      image: "arkiv-community-node-tunnel",
      running: s !== "tunnel_down",
      health: "none",
      restarts: s === "tunnel_down" ? 3 : 0,
      oomKilled: false,
      startedAt: s === "tunnel_down" ? null : started,
      cpuPct: s === "tunnel_down" ? null : 0.2,
      memBytes: s === "tunnel_down" ? null : 18e6,
      lastErrorLine: s === "tunnel_down" ? "login to server failed: dial tcp 2.29.34.87:7000: i/o timeout" : null,
    },
  ];
}

const hex = (seed: string, len = 64) => {
  let out = "";
  let h = hash(seed);
  while (out.length < len) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return `0x${out.slice(0, len)}`;
};

let hbCount = 0;
export function heartbeat(advance = false): HeartbeatState {
  if (advance) hbCount++;
  const head = headAt();
  return {
    enabled: true,
    writer: HEARTBEAT_WRITER,
    entityKey: hex("hb-entity"),
    lastTxHash: hex(`hb-tx-${hbCount}`),
    lastBlock: head - 2,
    lastAt: Date.now() - 3000,
    expiresAtBlock: head - 2 + 60,
    failuresInRow: 0,
    reason: null,
  };
}

const ALERT_HISTORY: AlertEvent[] = [
  {
    id: "al-1009",
    rule: "AgreementExpiringSoon",
    severity: "warning",
    status: "resolved",
    summary: "Agreement expires in 1 h 52 m; the load balancer refreshed it 4 minutes later.",
    startedAt: T0 - 2.4 * 3600_000,
    resolvedAt: T0 - 2.33 * 3600_000,
  },
  {
    id: "al-1008",
    rule: "NodeLagging",
    severity: "warning",
    status: "resolved",
    summary: "Head lag 23 blocks for 5 m after an execution restart.",
    startedAt: T0 - 9 * 3600_000,
    resolvedAt: T0 - 8.8 * 3600_000,
  },
  {
    id: "al-1007",
    rule: "HostCPUHigh",
    severity: "warning",
    status: "resolved",
    summary: "Host CPU above 90 % for 10 m during a slow-query run.",
    startedAt: T0 - 26 * 3600_000,
    resolvedAt: T0 - 25.7 * 3600_000,
  },
  {
    id: "al-1006",
    rule: "TunnelDown",
    severity: "critical",
    status: "resolved",
    summary: "frpc lost the connection to 2.29.34.87:7000 for 3 m.",
    startedAt: T0 - 50 * 3600_000,
    resolvedAt: T0 - 49.95 * 3600_000,
  },
  {
    id: "al-1005",
    rule: "LowGas",
    severity: "warning",
    status: "resolved",
    summary: "Heartbeat key balance below 0.1 tGLM; refilled from the faucet.",
    startedAt: T0 - 3.2 * 86400_000,
    resolvedAt: T0 - 3.1 * 86400_000,
  },
];

export const extraAlerts: AlertEvent[] = [];

function activeAlerts(): AlertEvent[] {
  const s = scen();
  const now = Date.now();
  const mk = (rule: string, severity: AlertEvent["severity"], summary: string): AlertEvent => ({
    id: `al-active-${rule}`,
    rule,
    severity,
    status: "firing",
    summary,
    startedAt: now - 7 * 60_000,
    resolvedAt: null,
  });
  switch (s) {
    case "lagging":
      return [mk("NodeLagging", "warning", "Head lag 184 blocks for 7 m (threshold 10 for 5 m).")];
    case "tunnel_down":
      return [mk("TunnelDown", "critical", "frpc is not running; the pool cannot reach port 20009.")];
    case "disk_low":
      return [mk("DiskDaysLeftLow", "warning", "Disk full in 2.7 days at 11.2 GB/day (threshold 7 d).")];
    case "container_down":
      return [
        mk("ContainerDown", "critical", "consensus restart-looping (6 restarts in 5 m)."),
        mk("NoPeers", "critical", "Consensus peers = 0."),
      ];
    case "no_agreement":
      return [mk("AgreementExpiringSoon", "warning", "No live agreement for the provider.")];
    default:
      return [];
  }
}

export function overview(): Overview {
  return {
    node: {
      chainId: CHAIN_ID,
      network: "rabdi",
      elVersion: "arkiv-reth/v1.0.0-4c9f5f2/x86_64-unknown-linux-gnu",
      clVersion: "Lighthouse/v8.3.1-a1b2c3d/x86_64-linux",
      providerAddress: PROVIDER,
      instanceName: "learing-test-rishabh",
    },
    verdict: verdict(),
    kpis: kpis(),
    containers: containers(),
    heartbeat: heartbeat(),
    recentAlerts: [...extraAlerts, ...activeAlerts(), ...ALERT_HISTORY].slice(0, 6),
    updatedAt: Date.now(),
  };
}

export function chain(range: Range): ChainResponse {
  const s = scen();
  const step = RANGE_STEP[range];
  const lagF = (t: number, sd: number) => {
    const ago = Date.now() - t;
    if (s === "lagging" && ago < 25 * 60_000) return Math.round(184 * (1 - ago / (25 * 60_000)) + noise(sd, t) * 4);
    // A short dip 4 h ago to make the history interesting.
    if (ago > 4 * 3600_000 && ago < 4 * 3600_000 + 12 * 60_000) return Math.round(23 * noise(sd, t / step));
    return noise(sd, t / 15_000) > 0.86 ? 1 : 0;
  };
  const reference = gen("ref_head", range, (t) => headAt(t));
  const lag = gen("head_lag", range, lagF);
  const head: Series = {
    metric: "el_head",
    labels: {},
    points: reference.points.map((p, i) => ({ t: p.t, v: p.v - (lag.points[i]?.v ?? 0) })),
  };
  return {
    range,
    head,
    reference,
    lag,
    peersEl: gen("peers_el", range, (t, sd) => Math.round(wave(t, sd, 12.5, 2, 1800_000))),
    peersCl: gen("peers_cl", range, (t, sd) => (s === "container_down" && Date.now() - t < 6 * 60_000 ? 0 : Math.round(wave(t, sd, 10, 1.4, 1800_000)))),
    syncing: s === "lagging",
    syncDistance: s === "lagging" ? 184 : 0,
    finalizedEpoch: Math.floor(headAt() / 32) - 2,
    justifiedEpoch: Math.floor(headAt() / 32) - 1,
    catchUpBlocksPerMin: s === "lagging" ? 41 : null,
  };
}

export function pool(): PoolResponse {
  const s = scen();
  const head = headAt();
  const agreementLeft = 1740 - (Math.floor((Date.now() - T0) / 2000) % 1800);
  return {
    providerAddress: PROVIDER,
    lbAddress: LB,
    currentBlock: head,
    balanceGlm: 4.8213,
    listing: {
      key: hex("lb-listing"),
      weiPerCall: "1000000000000000",
      maxProviders: 90,
      tunnelServer: "2.29.34.87:7000",
    },
    offer:
      s === "no_agreement"
        ? null
        : { key: hex("offer"), expiresAtBlock: head + 19_440, expiresInSec: 19_440 * 2 },
    agreement:
      s === "no_agreement"
        ? null
        : {
            key: hex("agreement"),
            remotePort: 20009,
            weiPerCall: "1000000000000000",
            updatedAtBlock: head - (1800 - agreementLeft),
            expiresAtBlock: head + agreementLeft,
            expiresInSec: agreementLeft * 2,
          },
    counter: {
      key: hex("counter"),
      count: 475,
      state: "open",
      openedBlock: 162_315,
      updatedAtBlock: head - 21_840,
    },
    receipts: [
      {
        key: hex("receipt-2"),
        createdAtBlock: head - 21_900,
        payload: { count: 312, amount_wei: "312000000000000000", tx: hex("payout-tx-2"), period: "2026-11-03" },
      },
      {
        key: hex("receipt-1"),
        createdAtBlock: head - 65_100,
        payload: { count: 163, amount_wei: "163000000000000000", tx: hex("payout-tx-1"), period: "2026-11-02" },
      },
    ],
  };
}

const METHODS: [string, number, number][] = [
  ["eth_blockNumber", 14, 2.1],
  ["arkiv_query", 7, 38],
  ["eth_getBlockByNumber", 5, 6.5],
  ["eth_call", 4, 11],
  ["eth_getBalance", 2.5, 3.2],
  ["eth_syncing", 2, 1.4],
  ["net_peerCount", 2, 1.1],
  ["eth_chainId", 1.5, 0.9],
];

export function rpc(range: Range): RpcResponse {
  const minutes = RANGE_MS[range] / 60_000;
  return {
    range,
    proxyMode: "passive",
    methods: METHODS.map(([method, rpm, p50]) => {
      const requests = Math.round(rpm * minutes * (0.95 + noise(hash(method), minutes) * 0.1));
      return {
        method,
        requests,
        errors: method === "arkiv_query" ? Math.round(requests * 0.012) : method === "eth_call" ? Math.round(requests * 0.004) : 0,
        p50Ms: p50,
        p95Ms: Math.round(p50 * (method === "arkiv_query" ? 6.2 : 2.6) * 10) / 10,
      };
    }),
    requestsPerMin: METHODS.map(([method, rpm]) =>
      gen("rpc_rpm", range, (t, sd) => Math.max(0, wave(t, sd, rpm, rpm * 0.4, 300_000)), { method }),
    ),
  };
}

export function fleet(): FleetResponse {
  const head = headAt();
  const sec = Math.floor(Date.now() / 1000);
  const ring = (offset: number) => {
    const left = 120 - ((sec + offset) % 30) - 0;
    return { expiresAtBlock: head + Math.round(left / 2), expiresInSec: left };
  };
  const s = scen();
  return {
    currentBlock: head,
    nodes: [
      {
        entityKey: hex("hb-entity"),
        creator: HEARTBEAT_WRITER,
        provider: PROVIDER,
        status: s === "healthy" ? "ok" : s === "container_down" || s === "tunnel_down" ? "down" : "degraded",
        verdict: verdict().code,
        headLag: s === "lagging" ? 184 : 0,
        diskDaysLeft: diskForecast().daysToFull,
        peersEl: 13,
        peersCl: s === "container_down" ? 0 : 10,
        client: "arkiv-reth/v1.0.0 + Lighthouse/v8.3.1",
        label: "learing-test-rishabh",
        profile: { name: "Rishabh, Mumbai", country: "IN", contact: "@onerx", verified: true, issuedAt: T0 - 3600_000 },
        agentVersion: "nodewatch/0.1.0",
        ...ring(0),
        trusted: true,
        isSelf: true,
      },
      {
        entityKey: hex("hb-2"),
        creator: "0x9a41c6B0dE2f87A3315bC4E0aF7d91C2e6B85d3F",
        provider: "0x3C7e1D9a40F2b6E8c51A7d0B92fE4c6A18D5b2E7",
        status: "ok",
        verdict: "healthy",
        headLag: 0,
        diskDaysLeft: 212.4,
        peersEl: 15,
        peersCl: 11,
        client: "arkiv-reth/v1.0.0 + Lighthouse/v8.3.1",
        label: "Berlin node",
        profile: { name: "Andrei, Berlin", country: "DE", contact: "", verified: true, issuedAt: T0 - 86_400_000 },
        agentVersion: "nodewatch/0.1.0",
        ...ring(11),
        trusted: true,
        isSelf: false,
      },
      {
        entityKey: hex("hb-3"),
        creator: "0x1f2E3d4C5b6A79881726354a3B2c1D0e9F8a7B6c",
        provider: "0xA81b2C3d4E5f60718293a4B5c6D7e8F9012a3B4c",
        status: "degraded",
        verdict: "lagging",
        headLag: 37,
        diskDaysLeft: 41.9,
        peersEl: 4,
        peersCl: 6,
        client: "arkiv-reth/v1.0.0 + Lighthouse/v8.2.0",
        label: "Tokyo node",
        profile: null,
        agentVersion: "nodewatch/0.1.0",
        ...ring(19),
        trusted: true,
        isSelf: false,
      },
      {
        entityKey: hex("hb-4"),
        creator: "0x7D6c5B4a39281706F5e4D3c2B1a0998877665544",
        provider: "0x55aA66bB77cC88dD99eE00fF11aA22bB33cC44dD",
        status: "ok",
        verdict: "healthy",
        headLag: 1,
        diskDaysLeft: 8.6,
        peersEl: 9,
        peersCl: 8,
        client: "arkiv-reth/v1.0.0 + Lighthouse/v8.3.1",
        label: null,
        profile: null,
        agentVersion: "nodewatch/0.0.9",
        ...ring(23),
        trusted: false,
        isSelf: false,
      },
      {
        entityKey: hex("hb-5"),
        creator: "0x2B3c4D5e6F708192a3B4c5D6e7F8091a2B3c4D5e",
        provider: "0x6E7f8091A2b3C4d5E6f708192A3b4C5d6E7f8091",
        status: "down",
        verdict: "tunnel_down",
        headLag: 0,
        diskDaysLeft: 95.2,
        peersEl: 12,
        peersCl: 9,
        client: "arkiv-reth/v1.0.0 + Lighthouse/v8.3.1",
        label: "Old node",
        profile: null,
        agentVersion: "nodewatch/0.1.0",
        expiresAtBlock: head + 9,
        expiresInSec: 18 - (sec % 18),
        trusted: true,
        isSelf: false,
      },
    ],
  };
}

export const silences: AlertsResponse["silences"] = [
  { id: "sil-1", rule: "HostCPUHigh", until: T0 + 47 * 60_000, createdBy: "0x7a3B…admin" },
];
export const channelSends: Record<string, number> = {
  telegram: T0 - 2.33 * 3600_000,
};

export function alerts(): AlertsResponse {
  return {
    channels: [
      { name: "telegram", configured: true, lastSendAt: channelSends.telegram ?? null, lastError: null },
      {
        name: "pagerduty",
        configured: true,
        lastSendAt: T0 - 50 * 3600_000,
        lastError: "429 Too Many Requests (retried 3 times, delivered)",
      },
    ],
    active: activeAlerts(),
    history: [...extraAlerts, ...ALERT_HISTORY],
    silences: silences.filter((x) => x.until > Date.now()),
  };
}

// ---- Slow-query finder ----
// Mirrors the server's catalog (apps/server/src/bench/shapes.ts): same names, families and datasets; ids are fake.
type MockShape = [name: string, label: string, family: string, select?: "keys" | "bytes", paging?: { method: "offset" | "cursor"; depthPct: number }];
const SYN: MockShape[] = [
  ["eq_str", "= on indexed str", "equality"],
  ["gt_u64", "> on u64", "range"],
  ["between_u64", "BETWEEN on u64", "range"],
  ["gt_dec", "> on dec", "range"],
  ["between_dec", "BETWEEN on dec", "range"],
  ["startswith", "STARTSWITH on str", "prefix"],
  ["exists", "EXISTS", "existence"],
  ["typeof", "TYPEOF", "existence"],
  ...[2, 3, 4, 5].map((k): MockShape => [`and_${k}`, `AND chain of ${k} terms`, "and"]),
  ...[2, 4, 8].map((k): MockShape => [`or_${k}`, `OR fan-out ${k}`, "or"]),
  ["mixed", "mixed AND/OR with parentheses", "mixed"],
  ["order_indexed", "ORDER BY indexed u64", "order"],
  ["order_nonindexed", "ORDER BY non-indexed str", "order"],
  ["select_keys", "keys-only selection", "selection"],
  ["select_bytes", "full selection incl. bytes", "selection", "bytes"],
  ["owner", "$owner filter", "system"],
  ...[0, 25, 50, 90].map((d): MockShape => [`page_offset_d${d}`, `offset paging at ${d} %`, "paging", "keys", { method: "offset", depthPct: d }]),
  ...[0, 25, 50, 90].map((d): MockShape => [`page_cursor_d${d}`, `key-cursor paging at ${d} %`, "paging", "keys", { method: "cursor", depthPct: d }]),
];
const MK: MockShape[] = [
  ["mk_creator", "$creator filter", "system"],
  ["mk_creator_kind", "$creator AND = str", "and"],
  ["mk_and_3", "AND chain of 3 terms", "and"],
  ["mk_or", "OR fan-out 3", "or"],
  ["mk_startswith", "STARTSWITH on str", "prefix"],
  ["mk_select_bytes", "full selection incl. bytes", "selection", "bytes"],
  ["mk_order", "ORDER BY $key", "order"],
  ...[0, 50, 90].map((d): MockShape => [`mk_page_offset_d${d}`, `offset paging at ${d} %`, "paging", "keys", { method: "offset", depthPct: d }]),
  ...[0, 50, 90].map((d): MockShape => [`mk_page_cursor_d${d}`, `key-cursor paging at ${d} %`, "paging", "keys", { method: "cursor", depthPct: d }]),
];
const mockId = (name: string) => `s_${hash(name).toString(16).padStart(8, "0")}${hash(name + "#").toString(16).slice(0, 4)}`;
const template = (name: string, mk: boolean) =>
  mk ? `$creator = addr(${LB}) AND … /* ${name} */` : `arkiv.schema = str('nwbench.item') AND run = str('<run>') AND … /* ${name} */`;

export function benchCatalog(withTemplate: boolean): BenchCatalog {
  const shapes = [...SYN.map((x) => [x, false] as const), ...MK.map((x) => [x, true] as const)].map(([[name, label, family, select, paging], mk]) => ({
    id: mockId(name),
    name,
    label,
    family,
    dataset: (mk ? "marketplace" : "synthetic") as "marketplace" | "synthetic",
    select: select ?? "keys",
    limit: paging ? (mk ? 20 : 50) : 100,
    paging: paging ?? null,
    summary: BENCH_SHAPE_NOTES[name]?.summary ?? label,
    tests: BENCH_SHAPE_NOTES[name]?.tests ?? "",
    template: withTemplate ? template(name, mk) : null,
  }));
  return {
    datasets: BENCH_DATASETS,
    families: BENCH_FAMILIES,
    shapes,
    thresholds: { slowP95Ms: SLOW_P95_MS, slowK: SLOW_K },
    method: { runsPerShape: 30, warmupRuns: 5, seedParallel: 8 },
  };
}

// Growth per family: most flat, AND chains and full scans about linear, one deliberately slow case for the demo.
const K_BY: Record<string, number> = { and_4: 0.86, and_5: 0.9, order_nonindexed: 1.32, page_offset_d90: 1.05, page_offset_d50: 0.78, exists: 0.05, typeof: 0.74, or_8: 0.62 };
const SIZES = [500, 1000, 2500, 5000];

function results(withText: boolean, sizes: number[], upto: number, readonly: boolean, seedTag: string): { results: BenchResult[]; scaling: BenchRun["scaling"] } {
  const res: BenchResult[] = [];
  const scaling: BenchRun["scaling"] = [];
  const list = readonly ? MK : SYN;
  for (const [name, , family, select] of list) {
    const shapeId = mockId(name);
    const seed = hash(name + seedTag);
    const base = 3 + noise(seed, 1) * 3 + (select === "bytes" ? 4 : 0);
    const k = readonly ? 0 : (K_BY[name] ?? 0.05 + noise(seed, 3) * 0.55);
    sizes.forEach((size, j) => {
      if (j / sizes.length >= upto) return;
      const p50 = base * Math.pow(size / 500, k);
      const samples = Array.from({ length: 25 }, (_, i) => Math.round(p50 * (0.85 + noise(seed, size + i) * 0.35 + (i % 11 === 0 ? 0.5 : 0)) * 100) / 100);
      const sorted = [...samples].sort((a, b) => a - b);
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      res.push({
        shapeId,
        shapeText: withText ? template(name, readonly).replace("<run>", "r" + seedTag) : null,
        name,
        family,
        dataset: readonly ? "marketplace" : "synthetic",
        size,
        p50Ms: sorted[12]!,
        p95Ms: sorted[23]!,
        p99Ms: sorted[24]!,
        rows: name === "and_5" ? Math.round(size * 0.05) : 100,
        errors: 0,
        bytes: select === "bytes" ? 100 * 420 : 100 * 72,
        stats: {
          minMs: sorted[0]!,
          maxMs: sorted[24]!,
          meanMs: Math.round(mean * 100) / 100,
          stdMs: Math.round(Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / 24) * 100) / 100,
          samples,
        },
      });
    });
    const big = res.filter((r) => r.shapeId === shapeId).at(-1);
    scaling.push({ shapeId, k: Math.round(k * 1000) / 1000, slow: k > SLOW_K || (big?.p95Ms ?? 0) > SLOW_P95_MS });
  }
  return { results: res, scaling };
}

interface MockRun {
  id: string;
  target: BenchRun["target"];
  sizes: number[];
  startedAt: number;
  durationMs: number;
}
export const benchRuns: MockRun[] = [
  { id: "a53a29e1-6586-4ce9-916d-c93fab990392", target: "sandbox", sizes: SIZES, startedAt: T0 - 1.5 * 3600_000, durationMs: 36_000 },
  { id: "5d1c0e77-2b9a-4c11-a0aa-1e4f5b6c7d80", target: "readonly", sizes: [24], startedAt: T0 - 3 * 3600_000, durationMs: 9_000 },
  { id: "14014ade-0c3b-4f0e-9d7f-6a8b2c1d3e4f", target: "sandbox", sizes: SIZES, startedAt: T0 - 9 * 3600_000, durationMs: 13.9 * 60_000 },
];

export function benchRun(r: MockRun, withText: boolean, lite = false): BenchRun {
  const elapsed = Date.now() - r.startedAt;
  const progress = Math.min(1, elapsed / r.durationMs);
  const done = progress >= 1;
  const readonly = r.target === "readonly";
  const { results: res, scaling } = results(withText, r.sizes, done ? 1 : progress, readonly, r.id.slice(0, 8));
  const status: BenchRun["status"] = done ? "done" : progress < 0.15 ? "seeding" : "running";
  const seedShare = readonly ? 0 : 0.33;
  return {
    id: r.id,
    status,
    target: r.target,
    sizes: r.sizes,
    startedAt: r.startedAt,
    finishedAt: done ? r.startedAt + r.durationMs : null,
    progress,
    message: done
      ? `${scaling.filter((s) => s.slow).length} slow shapes of ${scaling.length}`
      : status === "seeding"
        ? `seeding ${Math.round((progress / 0.15) * 5000)} / 5000 items (8 batches in parallel)`
        : `measuring at size ${r.sizes[Math.min(r.sizes.length - 1, Math.floor(progress * r.sizes.length))]}`,
    results: (done ? res : res.filter((x) => x.size <= (r.sizes[Math.floor(progress * r.sizes.length)] ?? 0))).map((x) => (lite ? { ...x, stats: null } : x)),
    scaling: done ? scaling : [],
    meta: {
      dataset: readonly ? "marketplace" : "synthetic",
      runsPerShape: 30,
      warmupRuns: 5,
      seedParallel: readonly ? null : 8,
      seed: readonly ? [] : r.sizes.map((size, i) => ({ size, items: size - (r.sizes[i - 1] ?? 0), ms: Math.round(((size - (r.sizes[i - 1] ?? 0)) / 5000) * r.durationMs * seedShare) })),
      measure: r.sizes.map((size) => ({ size, ms: Math.round((r.durationMs * (1 - seedShare)) / r.sizes.length) })),
      client: readonly ? "reth/v1.0.0-arkiv/x86_64-unknown-linux-gnu" : "reth/v1.9.1-dev/x86_64-unknown-linux-gnu",
      chainId: readonly ? CHAIN_ID : 1337,
      startBlock: readonly ? 214_366 : 1,
      endBlock: done ? (readonly ? 214_371 : 140) : null,
    },
  };
}

// ---- Autopilot ----
const ap = { enabled: true, keyUnlocked: true, label: "learing-test-rishabh" as string | null };
export function autopilotSet(patch: Partial<typeof ap>) {
  Object.assign(ap, patch);
}
export function autopilot(): AutopilotState {
  return {
    enabled: ap.enabled,
    providerAddress: PROVIDER,
    keyUnlocked: ap.keyUnlocked,
    keyUnlockedAt: ap.keyUnlocked ? T0 - 40 * 60_000 : null,
    keystoreError: null,
    kitWritable: null,
    tunnelConfiguredFor: hex("agreement-1"),
    label: ap.label,
    lastRun: T0 - 35_000,
    lastError: null,
    next: ap.enabled ? (ap.keyUnlocked ? "agreement ok (71 h left); tunnel running" : "provider key is locked") : "autopilot is off",
    recent: [
      { ts: T0 - 35_000, action: "tunnel-config", ok: 1, message: "agreement 0xcf3e597a…, port 20009: tunnel restarted (env updated, frpc.toml rendered)", tx_hash: null },
      { ts: T0 - 9 * 60_000, action: "post-offer", ok: 1, message: "offer posted (agreement 0xa1b2c3d4… expires in 5 h); 3/90 slots taken", tx_hash: hex("tx-offer") },
      { ts: T0 - 26 * 3600_000, action: "tunnel-start", ok: 1, message: "tunnel container started", tx_hash: null },
      { ts: T0 - 27 * 3600_000, action: "error", ok: 0, message: "the node is still syncing; the offer waits until it is current", tx_hash: null },
    ],
  };
}

// ---- Vault & backups ----
export const recipients: { address: string; label: string; addedAt: number }[] = [
  { address: "0x4F9a2B7c1D3e5F60718293A4b5C6d7E8f9012a3B", label: "Arkiv engineering (demo recipient)", addedAt: T0 - 20 * 3600_000 },
  { address: "0x8e1D2c3B4a5968776F5e4d3C2b1A0f9E8d7C6b5A", label: "Operator (Rishabh)", addedAt: T0 - 22 * 3600_000 },
];

export const bundles: Bundle[] = [
  {
    id: "bd-0006",
    kind: "diagnostic",
    scheme: "ecies-secp256k1-v1",
    recipient: recipients[0]!.address,
    swarmRef: hex("swarm-6").slice(2),
    entityKey: hex("bundle-entity-6"),
    sha256: hex("sha-6").slice(2),
    sizeBytes: 418_220,
    createdAt: T0 - 2.3 * 3600_000,
    status: "uploaded",
    error: null,
  },
  {
    id: "bd-0005",
    kind: "findings",
    scheme: "ecies-secp256k1-v1",
    recipient: recipients[0]!.address,
    swarmRef: hex("swarm-5").slice(2),
    entityKey: hex("bundle-entity-5"),
    sha256: hex("sha-5").slice(2),
    sizeBytes: 96_410,
    createdAt: T0 - 5 * 3600_000,
    status: "uploaded",
    error: null,
  },
  {
    id: "bd-0004",
    kind: "sample",
    scheme: "none",
    recipient: null,
    swarmRef: hex("swarm-4").slice(2),
    entityKey: hex("bundle-entity-4"),
    sha256: hex("sha-4").slice(2),
    sizeBytes: 52_118,
    createdAt: T0 - 19 * 3600_000,
    status: "uploaded",
    error: null,
  },
  {
    id: "bd-0003",
    kind: "backup",
    scheme: "ecies-secp256k1-v1",
    recipient: recipients[1]!.address,
    swarmRef: null,
    entityKey: null,
    sha256: hex("sha-3").slice(2),
    sizeBytes: 23_904,
    createdAt: T0 - 26 * 3600_000,
    status: "failed",
    error: "Bee returned 402: postage batch not usable yet (waiting for confirmations)",
  },
];

export const backupItems: BackupsResponse["items"] = [
  {
    id: "bk-0012",
    target: "local",
    kind: "keys-config",
    location: "/srv/nodewatch/backups/keys-config/2026-11-04T02-00Z.enc",
    sha256: hex("bk12").slice(2),
    sizeBytes: 14_336,
    ok: true,
    error: null,
    createdAt: T0 - 6 * 3600_000,
  },
  {
    id: "bk-0011",
    target: "swarm",
    kind: "keys-config",
    location: `bzz://${hex("bk11-ref").slice(2)}`,
    sha256: hex("bk11").slice(2),
    sizeBytes: 14_528,
    ok: true,
    error: null,
    createdAt: T0 - 6 * 3600_000,
  },
  {
    id: "bk-0010",
    target: "local",
    kind: "nodewatch-db",
    location: "/srv/nodewatch/backups/db/2026-11-04T02-00Z.sqlite.enc",
    sha256: hex("bk10").slice(2),
    sizeBytes: 38_912_000,
    ok: true,
    error: null,
    createdAt: T0 - 6 * 3600_000,
  },
  {
    id: "bk-0009",
    target: "local",
    kind: "nodewatch-db",
    location: "/srv/nodewatch/backups/db/2026-11-03T02-00Z.sqlite.enc",
    sha256: hex("bk9").slice(2),
    sizeBytes: 37_204_000,
    ok: true,
    error: null,
    createdAt: T0 - 30 * 3600_000,
  },
  {
    id: "bk-0008",
    target: "swarm",
    kind: "nodewatch-db",
    location: "",
    sha256: hex("bk8").slice(2),
    sizeBytes: 0,
    ok: false,
    error: "Bee upload timed out after 60 s (postage batch depth 20 is full)",
    createdAt: T0 - 30 * 3600_000,
  },
];

export function backups(): BackupsResponse {
  return {
    targets: [
      { name: "local", configured: true },
      { name: "swarm", configured: true },
    ],
    items: backupItems,
    lastSuccessAt: backupItems.find((b) => b.ok)?.createdAt ?? null,
  };
}

export { hex as mockHex };

// ---- one-click cleanup and node profile (mock) ----
const cleanupLeft = { build_cache: 5.1e9, dangling_images: 0.62e9 };
export function cleanupPreview(): CleanupPreview {
  return {
    available: true,
    reason: null,
    diskFree: 953e9,
    items: [
      { id: "build_cache", label: "Docker build cache", detail: "96 cached build steps. The next image build on this host is slower; nothing running uses them.", bytes: cleanupLeft.build_cache },
      { id: "dangling_images", label: "Untagged images", detail: "2 old image versions with no tag and no container. Tagged images, like the kit's marketplace image, are kept.", bytes: cleanupLeft.dangling_images },
    ],
  };
}
export function cleanupRun(ids: ("build_cache" | "dangling_images")[]): CleanupResult {
  const results = [...new Set(ids)].map((id) => {
    const b = cleanupLeft[id];
    cleanupLeft[id] = 0;
    return { id, ok: true, reclaimedBytes: b, error: null };
  });
  return { results, reclaimedBytes: results.reduce((a, r) => a + r.reclaimedBytes, 0) };
}

let profileDraft: NodeProfileFields | null = null;
let profilePub: NodeProfileState["published"] = null;
export function profileState(): NodeProfileState {
  const unlocked = autopilot().keyUnlocked;
  const reason = !unlocked ? "unlock the provider key first (Pool → Autopilot); it signs the profile, it never sends a transaction" : profileDraft ? null : "save a name and country first";
  return {
    draft: profileDraft,
    suggestedCountry: "IN",
    provider: PROVIDER.toLowerCase(),
    keyUnlocked: unlocked,
    writer: HEARTBEAT_WRITER,
    canPublish: !reason,
    reason,
    published: profilePub,
  };
}
export function profileSave(f: NodeProfileFields): string | null {
  const v = { name: f.name.trim(), country: f.country.trim().toUpperCase(), contact: (f.contact ?? "").trim() };
  if (!v.name || v.name.length > 48) return "name must be 1 to 48 characters";
  if (!/^[A-Z]{2}$/.test(v.country)) return "country must be a two-letter ISO code, like IN";
  profileDraft = v;
  return null;
}
export function profilePublish(): { entityKey: string; txHash: string } | { error: string } {
  const st = profileState();
  if (!st.canPublish || !profileDraft) return { error: st.reason ?? "cannot publish" };
  profilePub = { entityKey: hex("profile"), fields: profileDraft, issuedAt: Date.now(), expiresAtBlock: null, verified: true, txHash: hex(`ptx${Date.now()}`) };
  return { entityKey: profilePub.entityKey, txHash: profilePub.txHash! };
}

export function updateState(): UpdateState {
  return {
    image: "rishabhdev04/nodewatch:latest",
    revision: "c440eeb",
    runningDigest: "sha256:4b1d9c0f2a7e5b3c8d6e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c",
    latestDigest: "sha256:9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
    checkedAt: Date.now() - 4 * 60_000,
    checkError: null,
    updateAvailable: true,
    canUpdate: true,
    reason: null,
    inProgress: false,
    last: null,
  };
}

// ---- Live queries (Monitor → Live queries) ----
let inlineOn = true;
export function inlineSet(on: boolean) {
  inlineOn = on;
}
const SHAPES: [string, string, number, number][] = [
  // shape, method, requests/min, p50 ms
  ["$creator = addr(?) AND kind = str(?) AND provider = addr(?)", "arkiv_query", 2.4, 31],
  ["kind = str(?) AND state = str(?)", "arkiv_query", 1.9, 22],
  ["$owner = addr(?)", "arkiv_query", 1.4, 14],
  ["arkiv.schema = str(?) AND provider = addr(?)", "arkiv_query", 1.1, 27],
  ["$expiresAt > u64(?) AND kind = str(?)", "arkiv_query", 0.9, 118],
  ["name = str(?)", "arkiv_query", 0.8, 9],
  ["$key = key(?)", "arkiv_query", 0.7, 6],
  ["country = str(?) AND agentVersion = str(?)", "arkiv_query", 0.5, 41],
  ["n BETWEEN u64(?) AND u64(?)", "arkiv_query", 0.4, 203],
  ["tag = str(?) AND score > dec(?)", "arkiv_query", 0.3, 66],
  ["$creator = addr(?) AND kind = str(?) AND agreement = str(?)", "arkiv_query", 0.3, 19],
  ["cat = str(?) AND owner = addr(?)", "arkiv_query", 0.2, 340],
];
const LIVE_METHODS: [string, number, number][] = [
  ["arkiv_query", 10.9, 38],
  ["eth_blockNumber", 9, 2.1],
  ["eth_getBlockByNumber", 3, 6.5],
  ["arkiv_getEntity", 2.2, 5],
  ["eth_call", 1.5, 11],
  ["eth_chainId", 1.2, 1.1],
];
let feedSeq = 0;
export function recentRequests(n: number, now: number): RecentRequest[] {
  const out: RecentRequest[] = [];
  for (let i = 0; i < n; i++) {
    feedSeq++;
    const [method, , p50] = LIVE_METHODS[feedSeq % 7 === 0 ? 2 : feedSeq % 3 === 0 ? 1 : feedSeq % 5 === 0 ? 4 : 0]!;
    const shape = method === "arkiv_query" ? SHAPES[(feedSeq * 7) % SHAPES.length]! : null;
    const base = shape ? shape[3] : p50;
    const ms = Math.round(base * (0.6 + noise(feedSeq, 1) * 1.2 + (feedSeq % 17 === 0 ? 4 : 0)) * 10) / 10;
    const ok = feedSeq % 41 !== 0 && method !== "eth_getLogs";
    out.push({
      t: now - (n - i) * 300,
      method,
      shapeId: shape ? mockId(shape[0]) : null,
      ms,
      ok,
      batch: feedSeq % 9 === 0,
      query: shape ? sampleQuery(shape[0], feedSeq) : method === "eth_blockNumber" ? "[]" : method === "eth_getBlockByNumber" ? '["latest",false]' : '[{"to":"0x4400000000000000000000000000000000000044","data":"0x3f5e8d0e"},"latest"]',
      error: ok ? null : "expected a comparison operator (= < <= > >= !=)",
    });
  }
  return out;
}
const SAMPLE_VALUES = ["str('rpc.offer')", "str('nodewatch.heartbeat')", "addr(0xbd78b7d668282b8950774ab013706237b05a1880)", "u64(1793960000000)", "dec(0.75)", "key(0x06afbccf5b0f3ac38841b5276c478343e620b926)"];
function sampleQuery(shape: string, seed: number): string {
  let i = seed;
  return shape.replace(/(str|addr|u64|key|dec)\(\?\)/g, (_m, fn: string) => SAMPLE_VALUES.find((v, j) => v.startsWith(fn) && (i++ + j) % 2 === 0) ?? SAMPLE_VALUES.find((v) => v.startsWith(fn)) ?? "?").replace(/\?/g, () => String(10 + (i++ % 90)));
}
export function liveQueries(range: Range, withText = false): LiveQueriesResponse {
  const now = Date.now();
  const minutes = RANGE_MS[range] / 60_000;
  const on = inlineOn;
  const scale = on ? 1 : 0.04;
  const shapes: QueryShapeRow[] = SHAPES.map(([shape, method, rpm, p50]) => {
    const count = Math.max(1, Math.round(rpm * minutes * scale));
    const p95 = Math.round(p50 * 3.1 * 10) / 10;
    const max = Math.round(p50 * (6 + noise(hash(shape), 2) * 4) * 10) / 10;
    return {
      shapeId: mockId(shape),
      method,
      shape,
      count,
      errors: shape.includes("BETWEEN") ? Math.round(count * 0.03) : 0,
      avgMs: Math.round(p50 * 1.25 * 10) / 10,
      p50Ms: p50,
      p95Ms: p95,
      maxMs: max,
      maxAt: now - Math.round(noise(hash(shape), 5) * minutes * 60_000),
      firstSeen: now - 6 * 3600_000,
      lastSeen: now - Math.round(noise(hash(shape), 9) * 120_000),
    };
  }).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));
  const slowest: SlowRequest[] = shapes
    .filter((s) => s.maxMs >= 250)
    .flatMap((s): SlowRequest[] => [
      { t: s.maxAt, method: s.method, shapeId: s.shapeId, shape: s.shape, ms: s.maxMs, ok: true },
      { t: s.maxAt - 90_000, method: s.method, shapeId: s.shapeId, shape: s.shape, ms: Math.round(s.maxMs * 0.8), ok: s.errors === 0 },
    ])
    .concat([{ t: now - 7 * 60_000, method: "eth_call", shapeId: null, shape: null, ms: 612, ok: false }])
    .filter((r) => r.ms >= 250)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 20);
  const requests = Math.round(LIVE_METHODS.reduce((a, m) => a + m[1], 0) * minutes * scale);
  const groups: [string, number, number][] = [
    ["arkiv_query", 10.9, 38],
    ["eth_*", 14.7, 4],
    ["arkiv_other", 2.2, 5],
  ];
  const latency = (metric: string, factor: number) =>
    groups.slice(0, 2).map(([g, , p50]) => gen(metric, range, (t, sd) => Math.max(1, wave(t, sd, p50 * factor, p50 * factor * 0.35, 420_000)), { method: g }));
  return {
    range,
    mode: on ? "inline" : "passive",
    target: on ? { ip: "172.18.0.1", port: 18545 } : { ip: "execution", port: 8545 },
    proxy: { ip: "172.18.0.1", port: 18545 },
    drift: false,
    switching: false,
    live: {
      rpm: Math.round(27.8 * scale),
      avgMs: on ? 19.4 : 3.1,
      p50Ms: on ? 8.2 : 2.4,
      p95Ms: on ? 131 : 6,
      errorPct: on ? 0.31 : 0,
      lastRequestAt: now - 2200,
      requests,
      errors: Math.round(requests * 0.0031),
    },
    series: {
      requestsPerMin: groups.map(([g, rpm]) => gen("rpc_rpm", range, (t, sd) => Math.max(0, wave(t, sd, rpm * scale, rpm * scale * 0.4, 300_000)), { method: g })),
      avgMs: latency("rpc_latency_avg_ms", 1.25),
      p95Ms: latency("rpc_latency_p95_ms", 3.1),
      maxMs: latency("rpc_latency_max_ms", 7),
      errorPct: gen("rpc_error_pct", range, (t, sd) => Math.max(0, wave(t, sd, 0.3, 0.3, 600_000)), {}),
    },
    shapes: withText ? shapes.map((s, i) => ({ ...s, sample: sampleQuery(s.shape, i) })) : shapes,
    slowest: withText ? slowest.map((s, i) => ({ ...s, query: s.shape ? sampleQuery(s.shape, i) : '[{"fromBlock":"0x46000","toBlock":"0x46400"}]', error: s.ok ? null : "golemdb segment_range_of(transactions): NotImplemented" })) : slowest,
    recent: recentRequests(50, now).map((r, i) => (withText && r.shapeId ? { ...r, query: sampleQuery(SHAPES.find((s) => mockId(s[0]) === r.shapeId)?.[0] ?? "", i) } : r)),
    slowMs: 250,
    errorsByMethod: on
      ? [
          { method: "eth_getLogs", count: 72, lastCode: -32603, lastMessage: "golemdb segment_range_of(transactions): NotImplemented", lastAt: now - 40_000 },
          { method: "arkiv_query", count: 3, lastCode: -32001, lastMessage: "expected a comparison operator (= < <= > >= !=)", lastAt: now - 9 * 60_000 },
        ]
      : [],
  };
}
