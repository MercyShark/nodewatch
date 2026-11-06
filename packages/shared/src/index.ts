// API contract shared by apps/server and apps/web. Every /api response matches these types.
// Times are unix milliseconds unless the name says otherwise. Byte counts are numbers.
import type { BenchDatasetId, BenchDatasetInfo, BenchFamilyInfo, BenchTarget } from "./bench.js";
export * from "./bench.js";

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
  /** What the "Fix it" button does for this verdict; null when the fix needs a human (logs, hardware, faucet). */
  action?: FixAction | null;
  since: number;
}

/** One-click fixes the server can run itself. Every run re-checks the live verdict first and is logged. */
export type FixAction =
  | { kind: "restart_service"; service: ServiceName }
  | { kind: "autopilot_run" }
  | { kind: "disk_cleanup" };

export interface ActionLogEntry {
  ts: number;
  actor: string;
  action: string;
  target: string | null;
  ok: boolean;
  message: string;
}

/** Disk cleanup: only Docker build cache and untagged (dangling) images. Never volumes, never chain data. */
export type CleanupItemId = "build_cache" | "dangling_images";
export interface CleanupItem {
  id: CleanupItemId;
  label: string;
  detail: string;
  bytes: number;
}
export interface CleanupPreview {
  available: boolean;
  reason: string | null;
  diskFree: number | null;
  items: CleanupItem[];
}
export interface CleanupResult {
  results: { id: CleanupItemId; ok: boolean; reclaimedBytes: number; error: string | null }[];
  reclaimedBytes: number;
}

/**
 * Node profile on Arkiv (schema nodewatch.profile): a name, country and contact chosen by the operator, signed by the
 * provider key (EIP-191 personal_sign over profileMessage()). Readers verify the signature, so nobody can name
 * someone else's node. The entity itself is written and paid for by the heartbeat key.
 */
export interface NodeProfileFields {
  name: string;
  country: string; // ISO 3166-1 alpha-2, upper case
  contact: string; // optional handle or URL, may be ""
}
export interface NodeProfileState {
  draft: NodeProfileFields | null;
  suggestedCountry: string | null; // from the cloud region, when known
  provider: string | null;
  keyUnlocked: boolean;
  writer: string | null; // the heartbeat key that pays for the write
  canPublish: boolean;
  reason: string | null; // why publishing is not possible right now
  published: {
    entityKey: string;
    fields: NodeProfileFields;
    issuedAt: number;
    expiresAtBlock: number | null;
    verified: boolean;
    txHash: string | null;
  } | null;
}
export interface FleetProfile extends NodeProfileFields {
  verified: boolean;
  issuedAt: number;
}

export function profileMessage(p: { provider: string; chainId: number; issuedAt: number } & NodeProfileFields): string {
  return [
    "Nodewatch node profile",
    "",
    `Provider: ${p.provider.toLowerCase()}`,
    `Name: ${p.name}`,
    `Country: ${p.country}`,
    `Contact: ${p.contact}`,
    "",
    `Chain ID: ${p.chainId}`,
    `Issued At: ${new Date(p.issuedAt).toISOString()}`,
  ].join("\n");
}

const CONTROL = /[\u0000-\u001f\u007f]/;
/** Returns an error message, or null when the fields are valid. Newlines are refused so a field can't forge a line. */
export function validateProfile(p: NodeProfileFields): string | null {
  if (!p.name.trim() || p.name.length > 48) return "name must be 1 to 48 characters";
  if (!/^[A-Z]{2}$/.test(p.country)) return "country must be a two-letter ISO code, like IN";
  if (p.contact.length > 96) return "contact must be at most 96 characters";
  if ([p.name, p.contact].some((v) => CONTROL.test(v))) return "fields cannot contain line breaks or control characters";
  // Arkiv string attributes hold at most 128 UTF-8 bytes.
  const enc = new TextEncoder();
  if (enc.encode(p.name).length > 128 || enc.encode(p.contact).length > 128) return "name and contact must each fit in 128 bytes";
  return null;
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

/** One autopilot action, newest first. */
export type AutopilotEvent = { event: "autopilot"; data: AutopilotState };
export interface AutopilotAction {
  ts: number;
  action: string;
  ok: number;
  message: string;
  tx_hash: string | null;
}
export interface AutopilotState {
  enabled: boolean;
  providerAddress: string | null;
  keyUnlocked: boolean;
  keyUnlockedAt: number | null;
  keystoreError: string | null;
  /** Null when the node kit directory is writable; otherwise why the tunnel step cannot run. */
  kitWritable: string | null;
  /** The agreement the kit's .env is currently configured for. */
  tunnelConfiguredFor: string | null;
  label: string | null;
  lastRun: number | null;
  lastError: string | null;
  /** What the next tick would do. */
  next: string;
  recent: AutopilotAction[];
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

/** Live queries (Monitor → Live queries): what the pool's load balancer actually sends, seen by the inline proxy. */
export type ProxyMode = "passive" | "inline";
export interface RecentRequest {
  t: number;
  method: string;
  shapeId: string | null; // arkiv_query only
  ms: number;
  ok: boolean;
  batch: boolean;
}
export interface QueryShapeRow {
  shapeId: string;
  method: string;
  shape: string; // literals replaced by ?; never raw text
  count: number;
  errors: number;
  avgMs: number;
  p50Ms: number | null; // since the last restart
  p95Ms: number | null;
  maxMs: number;
  maxAt: number;
  firstSeen: number;
  lastSeen: number;
}
export interface SlowRequest {
  t: number;
  method: string;
  shapeId: string | null;
  shape: string | null;
  ms: number;
  ok: boolean;
}
export interface LiveQueriesResponse {
  range: Range;
  mode: ProxyMode;
  /** Where frpc sends the pool's traffic right now; null when the tunnel is not configured. */
  target: { ip: string; port: number } | null;
  /** The proxy address the tunnel points at in inline mode. */
  proxy: { ip: string | null; port: number };
  /** Inline is stored on but frpc.toml no longer points at the proxy (regenerated by hand). */
  drift: boolean;
  switching: boolean;
  live: { rpm: number; avgMs: number | null; p50Ms: number | null; p95Ms: number | null; errorPct: number | null; lastRequestAt: number | null; requests: number; errors: number };
  series: { requestsPerMin: Series[]; avgMs: Series[]; p95Ms: Series[]; maxMs: Series[]; errorPct: Series };
  shapes: QueryShapeRow[];
  slowest: SlowRequest[];
  recent: RecentRequest[];
  slowMs: number;
}

export interface RpcResponse {
  range: Range;
  proxyMode: ProxyMode;
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
  /** Operator-chosen name from the heartbeat (empty when the node has none). */
  label: string | null;
  /** Newest nodewatch.profile for this provider whose signature verifies, if any. */
  profile: FleetProfile | null;
  expiresAtBlock: number;
  expiresInSec: number;
  trusted: boolean;
  isSelf: boolean;
}
export interface FleetResponse {
  currentBlock: number | null;
  nodes: FleetNode[];
}

export type ChannelName = "telegram" | "pagerduty";
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

export interface BenchStats {
  minMs: number;
  maxMs: number;
  meanMs: number;
  stdMs: number;
  /** Every timed run after warm-up, in the order they ran (ms). */
  samples: number[];
}
export interface BenchResult {
  shapeId: string;
  shapeText: string | null; // admin only; null otherwise
  /** Catalog name (e.g. and_3). Null for a shape no longer in the catalog. */
  name: string | null;
  family: string | null;
  dataset: BenchDatasetId | null;
  size: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  rows: number;
  errors: number;
  /** Largest response body seen, bytes. */
  bytes: number;
  /** Null for runs recorded before per-sample stats were kept. */
  stats: BenchStats | null;
}
export interface BenchRunMeta {
  dataset: BenchDatasetId;
  runsPerShape: number;
  warmupRuns: number;
  seedParallel: number | null;
  /** Per size step: items written and how long seeding took. */
  seed: { size: number; items: number; ms: number }[];
  /** Per size step: how long measuring all shapes took. */
  measure: { size: number; ms: number }[];
  client: string | null;
  chainId: number;
  startBlock: number | null;
  endBlock: number | null;
}
export interface BenchRun {
  id: string;
  status: "queued" | "seeding" | "running" | "paused" | "done" | "failed";
  /** sandbox = throwaway dev chain (seeded, free); readonly = existing entities on our node, no writes;
   *  own-node = seeded on the public chain with a dedicated BENCH_PRIVATE_KEY. */
  target: BenchTarget;
  sizes: number[];
  startedAt: number;
  finishedAt: number | null;
  progress: number; // 0..1
  message: string | null;
  results: BenchResult[];
  scaling: { shapeId: string; k: number; slow: boolean }[];
  /** Null for runs recorded before run metadata was kept. */
  meta: BenchRunMeta | null;
}

/** The own-node bench writer: its address and tGLM balance (wei, decimal string). Never the key. */
export interface BenchWriter {
  address: string | null;
  balanceWei: string | null;
  /** Below this the server refuses to start an own-node run. */
  minWei: string;
  /** Why own-node runs cannot start, if they cannot. */
  problem: string | null;
}

export interface BenchShapeInfo {
  id: string;
  name: string;
  label: string;
  family: string;
  dataset: BenchDatasetId;
  select: "keys" | "bytes";
  limit: number;
  paging: { method: "offset" | "cursor"; depthPct: number } | null;
  summary: string;
  tests: string;
  /** Example query with placeholders (admin only, private). */
  template: string | null;
}
export interface BenchCatalog {
  datasets: BenchDatasetInfo[];
  families: BenchFamilyInfo[];
  shapes: BenchShapeInfo[];
  thresholds: { slowP95Ms: number; slowK: number };
  method: { runsPerShape: number; warmupRuns: number; seedParallel: number };
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
  target: "swarm" | "local";
  kind: "keys-config" | "nodewatch-db";
  location: string;
  sha256: string;
  sizeBytes: number;
  ok: boolean;
  error: string | null;
  createdAt: number;
}
export interface BackupsResponse {
  targets: { name: "swarm" | "local"; configured: boolean }[];
  items: BackupItem[];
  lastSuccessAt: number | null;
}

// Server-Sent Events on GET /api/stream: `event: <name>` + JSON data
export type StreamEvent =
  | { event: "verdict"; data: Verdict }
  | { event: "kpis"; data: Kpis }
  | { event: "heartbeat"; data: HeartbeatState }
  | { event: "alert"; data: AlertEvent }
  | { event: "containers"; data: ContainerState[] }
  | { event: "autopilot"; data: AutopilotState }
  | { event: "rpc"; data: RecentRequest[] };

/** Self-update from the published image (Settings → Updates). */
export interface UpdateResult {
  ok: boolean;
  at: number;
  from: string | null; // revision (or image id) before
  to: string | null; // revision (or digest) after
  message: string;
  rolledBack: boolean;
}
export interface UpdateState {
  image: string; // the image this install updates from, e.g. rishabhdev04/nodewatch:latest
  revision: string; // git revision baked into the running image; "dev" for local builds
  runningDigest: string | null; // registry digest of the running image, when it came from the registry
  latestDigest: string | null;
  checkedAt: number | null;
  checkError: string | null;
  updateAvailable: boolean | null; // null when unknown (not checked, or running a local build)
  canUpdate: boolean;
  reason: string | null; // why updating is not possible here
  inProgress: boolean;
  last: UpdateResult | null;
}
