// API contract shared by apps/server and apps/web. Every /api response matches these types.
// Times are unix milliseconds unless the name says otherwise. Byte counts are numbers.

export type Role = "admin" | "viewer";
export interface SessionUser {
  id: string;
  role: Role;
  address: string | null; // set for SIWE logins
  method: "siwe" | "password";
}

export type Severity = "info" | "warning" | "critical";
export type VerdictCode =
  | "container_down"
  | "oom"
  | "disk_full"
  | "wrong_chain"
  | "el_offline"
  | "lagging"
  | "no_peers"
  | "tunnel_down"
  | "no_agreement"
  | "low_gas"
  | "healthy"
  | "unknown";

export interface Verdict {
  code: VerdictCode;
  severity: Severity | "ok";
  title: string; // one plain sentence
  detail: string;
  fix: string | null; // exact command, copyable
  since: number;
}

export type ServiceName = "execution" | "consensus" | "tunnel";
export interface ContainerState {
  service: ServiceName;
  name: string;
  image: string;
  running: boolean;
  health: "healthy" | "unhealthy" | "starting" | "none";
  restarts: number;
  oomKilled: boolean;
  startedAt: string | null;
  cpuPct: number | null;
  memBytes: number | null;
  lastErrorLine: string | null;
}

export interface Kpis {
  headBlock: number | null;
  referenceHead: number | null;
  headLag: number | null;
  peersEl: number | null;
  peersCl: number | null;
  syncing: boolean | null;
  diskDaysLeft: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  chainDataBytes: number | null; // el-data + cl-data
  cpuPct: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  providerBalanceGlm: number | null;
  heartbeatBalanceGlm: number | null;
  rpcRequestsPerMin: number | null;
}

export interface HeartbeatState {
  enabled: boolean;
  writer: string | null; // heartbeat key address
  entityKey: string | null;
  lastTxHash: string | null;
  lastBlock: number | null;
  lastAt: number | null;
  expiresAtBlock: number | null;
  failuresInRow: number;
  reason: string | null; // why disabled / last error
}

export interface NodeInfo {
  chainId: number | null;
  network: string;
  elVersion: string | null;
  clVersion: string | null;
  providerAddress: string | null;
  instanceName: string | null;
}

export interface Overview {
  node: NodeInfo;
  verdict: Verdict;
  kpis: Kpis;
  containers: ContainerState[];
  heartbeat: HeartbeatState;
  recentAlerts: AlertEvent[];
  updatedAt: number;
}

export type Range = "1h" | "6h" | "24h" | "7d" | "30d";
export interface SeriesPoint {
  t: number;
  v: number;
}
export interface Series {
  metric: string;
  labels: Record<string, string>;
  points: SeriesPoint[];
}

export interface ResourcesResponse {
  range: Range;
  host: {
    cpuPct: Series;
    memUsedBytes: Series;
    diskUsedBytes: Series;
    diskReadBps: Series;
    diskWriteBps: Series;
    netRxBps: Series;
    netTxBps: Series;
    load1: Series;
  };
  containers: Record<ServiceName, { cpuPct: Series; memBytes: Series }>;
}

export interface DiskForecast {
  samples: SeriesPoint[]; // chain data used bytes
  projection: SeriesPoint[]; // dashed line until "full"
  freeBytes: number | null;
  totalBytes: number | null;
  volumes: { el: number | null; cl: number | null };
  ratePerDay6h: number | null; // bytes/day
  ratePerDay24h: number | null;
  daysToFull: number | null;
  thresholds: { warnDays: number; critDays: number };
}

export interface ChainResponse {
  range: Range;
  head: Series;
  reference: Series;
  lag: Series;
  peersEl: Series;
  peersCl: Series;
  syncing: boolean | null;
  syncDistance: number | null;
  finalizedEpoch: number | null;
  justifiedEpoch: number | null;
  catchUpBlocksPerMin: number | null;
}

export interface PoolResponse {
  providerAddress: string | null;
  lbAddress: string;
  currentBlock: number | null;
  balanceGlm: number | null;
  listing: { key: string; weiPerCall: string; maxProviders: number; tunnelServer: string } | null;
  offer: { key: string; expiresAtBlock: number; expiresInSec: number } | null;
  agreement: {
    key: string;
    remotePort: number;
    weiPerCall: string;
    updatedAtBlock: number;
    expiresAtBlock: number;
    expiresInSec: number;
  } | null;
  counter: { key: string; count: number; state: string; openedBlock: number; updatedAtBlock: number } | null;
  receipts: { key: string; createdAtBlock: number; payload: Record<string, unknown> }[];
}

export interface RpcResponse {
  range: Range;
  proxyMode: "passive" | "inline";
  methods: { method: string; requests: number; errors: number; p50Ms: number | null; p95Ms: number | null }[];
  requestsPerMin: Series[]; // one per method
}

export interface FleetNode {
  entityKey: string;
  creator: string;
  provider: string;
  status: "ok" | "degraded" | "down";
  verdict: VerdictCode | string;
  headLag: number | null;
  diskDaysLeft: number | null;
  peersEl: number | null;
  peersCl: number | null;
  client: string | null;
  agentVersion: string | null;
  expiresAtBlock: number;
  expiresInSec: number;
  trusted: boolean;
  isSelf: boolean;
}
export interface FleetResponse {
  currentBlock: number | null;
  nodes: FleetNode[];
}

export type ChannelName = "telegram" | "slack" | "pagerduty";
export interface AlertEvent {
  id: string;
  rule: string;
  severity: Severity;
  status: "firing" | "resolved";
  summary: string;
  startedAt: number;
  resolvedAt: number | null;
}
export interface Silence {
  id: string;
  rule: string | null; // null = all
  until: number;
  createdBy: string;
}
export interface AlertsResponse {
  channels: { name: ChannelName; configured: boolean; lastSendAt: number | null; lastError: string | null }[];
  active: AlertEvent[];
  history: AlertEvent[];
  silences: Silence[];
}

export interface BenchResult {
  shapeId: string;
  shapeText: string | null; // admin only; null otherwise
  size: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  rows: number;
  errors: number;
}
export interface BenchRun {
  id: string;
  status: "queued" | "seeding" | "running" | "paused" | "done" | "failed";
  /** sandbox = throwaway dev chain (seeded, free); readonly = existing entities on our node, no writes;
   *  own-node = seeded on the public chain with a dedicated BENCH_PRIVATE_KEY. */
  target: "sandbox" | "readonly" | "own-node";
  sizes: number[];
  startedAt: number;
  finishedAt: number | null;
  progress: number; // 0..1
  message: string | null;
  results: BenchResult[];
  scaling: { shapeId: string; k: number; slow: boolean }[];
}

export interface Bundle {
  id: string;
  kind: "diagnostic" | "findings" | "backup" | "sample";
  scheme: "ecies-secp256k1-v1" | "none";
  recipient: string | null;
  swarmRef: string | null;
  entityKey: string | null;
  sha256: string;
  sizeBytes: number;
  createdAt: number;
  status: "uploaded" | "local-only" | "failed";
  error: string | null;
}
export interface VaultResponse {
  beeConfigured: boolean;
  beeMode: "external" | "embedded";
  postageBatchId: string | null;
  recipients: { address: string; label: string; addedAt: number }[];
  bundles: Bundle[];
}

export interface BackupItem {
  id: string;
  target: "s3" | "swarm" | "local";
  kind: "keys-config" | "nodewatch-db";
  location: string;
  sha256: string;
  sizeBytes: number;
  ok: boolean;
  error: string | null;
  createdAt: number;
}
export interface BackupsResponse {
  targets: { name: "s3" | "swarm" | "local"; configured: boolean }[];
  items: BackupItem[];
  lastSuccessAt: number | null;
}

// Server-Sent Events on GET /api/stream: `event: <name>` + JSON data
export type StreamEvent =
  | { event: "verdict"; data: Verdict }
  | { event: "kpis"; data: Kpis }
  | { event: "heartbeat"; data: HeartbeatState }
  | { event: "alert"; data: AlertEvent }
  | { event: "containers"; data: ContainerState[] };
