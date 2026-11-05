// zod-validated environment. Every env var the server reads is declared here (and only here).
import { existsSync } from "node:fs";
import path from "node:path";
import { parseAuthorization } from "./auth/nodeAuth.js";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const optStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const addrList = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^0x[0-9a-f]{40}$/.test(s)),
  );

const optAddr = optStr.refine((v) => v === undefined || /^0x[0-9a-fA-F]{40}$/.test(v), "must be a 0x address");
const optKey = optStr.refine((v) => v === undefined || /^0x[0-9a-fA-F]{64}$/.test(v), "must be a 0x-prefixed 32-byte hex key");
const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .refine((n) => Number.isFinite(n), "must be a number");

const schema = z.object({
  NODE_ENV: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  HOST: z.string().default("127.0.0.1"),
  PORT: num(8080),
  PROXY_PORT: num(18545),
  PROXY_HOST: z.string().default("127.0.0.1"), // the RPC proxy stays on loopback even when the UI is public
  PROXY_MODE: z.enum(["passive", "inline"]).default("passive"),
  TRUST_PROXY: bool(false),
  DATA_DIR: z.string().default("./data"),
  WEB_DIST: optStr,
  HOST_PROC: optStr,
  HOST_ROOT: optStr,
  DATA_ROOT: optStr,
  DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),
  NODE_KIT_DIR: optStr,
  INSTANCE_NAME: optStr,
  AGENT_VERSION: z.string().default("nodewatch/0.1.0"),

  NODE_COMPOSE_PROJECT: z.string().default("arkiv-community-node"),
  EL_RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  CL_API_URL: z.string().url().default("http://127.0.0.1:5052"),
  TUNNEL_STATUS_URL: z.string().url().default("http://127.0.0.1:7400/api/status"),
  PROVIDER_ADDRESS: optAddr,

  ARKIV_CHAIN_ID: num(7794095),
  ARKIV_NETWORK: z.string().default("rabdi"),
  ARKIV_REFERENCE_RPC: z.string().url().default("https://rpc.rabdi.db-chain.testnet.arkiv.network"),
  ARKIV_ACCESS_KEY: optStr,
  ARKIV_EXPLORER_URL: z.string().default("https://rabdi.explorer.arkiv.network"),
  HEARTBEAT_PRIVATE_KEY: optKey,
  HEARTBEAT_ENABLED: bool(false),
  HEARTBEAT_INTERVAL_SEC: num(30),
  HEARTBEAT_EXPIRY_BLOCKS: num(60),
  BUNDLE_WRITER_PRIVATE_KEY: optKey,
  LB_ADDRESS: optAddr.transform((v) => v ?? "0xCA4B166EE155Cb2816Dc25f94Dc1fD102a26c997"),
  SETTLE_ADDRESS: optAddr.transform((v) => v ?? "0x411E31d7eBbfd636Af234954db5f598Cd80a878C"),
  FLEET_TRUSTED_CREATORS: addrList,
  LOW_GAS_THRESHOLD_GLM: num(0.5),

  BEE_MODE: z.enum(["external", "embedded"]).default("external"),
  BEE_API_URL: optStr,
  BEE_POSTAGE_BATCH_ID: optStr,
  ARKIV_RECIPIENT_ADDRESS: optAddr,
  OPERATOR_RECIPIENT_ADDRESS: optAddr,

  ADMIN_ADDRESSES: addrList,
  VIEWER_ADDRESSES: addrList,
  /** <provider>:<admin>:<issuedAt>:<signature>, signed once by the node's provider key (see auth/nodeAuth.ts). */
  NODE_AUTHORIZATION: optStr,
  /** Optional: unlocks the provider keystore at boot (in memory only) so the autopilot needs no human at all. */
  PROVIDER_KEYSTORE_PASSWORD: optStr,
  AUTOPILOT_INTERVAL_SEC: num(60),
  ADMIN_USERNAME: z.string().min(1).max(64).default("admin"),
  ADMIN_PASSWORD_HASH: optStr,
  SESSION_SECRET: optStr,
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:8080"),
  AUTH_DEV_BYPASS: bool(false),

  TELEGRAM_BOT_TOKEN: optStr,
  TELEGRAM_CHAT_ID: optStr,
  PAGERDUTY_ROUTING_KEY: optStr,

  BACKUP_SWARM_ENABLED: bool(true),
  BACKUP_INTERVAL_HOURS: num(24),

  BENCH_SANDBOX_IMAGE: z.string().default("ghcr.io/arkiv-network/arkiv-reth-dev:latest"),
  BENCH_SANDBOX_PORT: num(28545),
  BENCH_PRIVATE_KEY: optKey,
  BENCH_RUNS_PER_SHAPE: num(30),
  BENCH_WARMUP_RUNS: num(5),
  BENCH_SEED_PARALLEL: num(8), // batches in flight while seeding (own-node is capped at 4)
});

export type Env = z.infer<typeof schema>;

function firstExisting(preferred: string, fallback: string): string {
  return existsSync(preferred) ? preferred : fallback;
}

export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  if (e.AUTH_DEV_BYPASS && !isLoopback(e.HOST)) {
    throw new Error("AUTH_DEV_BYPASS=1 is refused unless HOST is a loopback address");
  }
  const dataDir = path.resolve(e.DATA_DIR);
  // The node authorisation names the admin wallet; it joins ADMIN_ADDRESSES. The signature is verified at boot.
  const nodeAuth = e.NODE_AUTHORIZATION ? parseAuthorization(e.NODE_AUTHORIZATION) : null;
  const adminAddresses = nodeAuth ? [...new Set([...e.ADMIN_ADDRESSES, nodeAuth.admin.toLowerCase()])] : e.ADMIN_ADDRESSES;
  if (nodeAuth && e.PROVIDER_ADDRESS && e.PROVIDER_ADDRESS.toLowerCase() !== nodeAuth.provider.toLowerCase()) {
    throw new Error(`NODE_AUTHORIZATION is for provider ${nodeAuth.provider} but PROVIDER_ADDRESS is ${e.PROVIDER_ADDRESS}`);
  }
  const cfg = {
    ...e,
    ADMIN_ADDRESSES: adminAddresses,
    PROVIDER_ADDRESS: e.PROVIDER_ADDRESS ?? nodeAuth?.provider,
    nodeAuth,
    DATA_DIR: dataDir,
    WEB_DIST: path.resolve(e.WEB_DIST ?? path.join(here, "..", "..", "web", "dist")),
    HOST_PROC: e.HOST_PROC ?? firstExisting("/host/proc", "/proc"),
    HOST_ROOT: e.HOST_ROOT ?? firstExisting("/host/root", "/"),
    DATA_ROOT: e.DATA_ROOT ?? firstExisting("/data-root", "/var/lib/docker"),
    NODE_KIT_DIR: e.NODE_KIT_DIR ?? firstExisting("/host/root/opt/arkiv-community-node", "/opt/arkiv-community-node"),
    // No fallback to the heartbeat key: two writers on one key collide on nonces and break heartbeats.
    BENCH_PRIVATE_KEY: e.BENCH_PRIVATE_KEY,
    BUNDLE_WRITER_PRIVATE_KEY: e.BUNDLE_WRITER_PRIVATE_KEY ?? e.HEARTBEAT_PRIVATE_KEY,
    secureCookies: e.PUBLIC_ORIGIN.startsWith("https://"),
    findingsDir: path.resolve(dataDir, "findings"),
  };
  return cfg;
}

export type Config = ReturnType<typeof loadConfig>;

/** A redacted view for logs and the settings page. Never includes keys, tokens or hashes. */
export function publicConfig(c: Config) {
  return {
    host: c.HOST,
    port: c.PORT,
    proxyPort: c.PROXY_PORT,
    proxyMode: c.PROXY_MODE,
    elRpcUrl: c.EL_RPC_URL,
    clApiUrl: c.CL_API_URL,
    tunnelStatusUrl: c.TUNNEL_STATUS_URL,
    providerAddress: c.PROVIDER_ADDRESS ?? null,
    network: c.ARKIV_NETWORK,
    chainId: c.ARKIV_CHAIN_ID,
    heartbeatEnabled: c.HEARTBEAT_ENABLED && !!c.HEARTBEAT_PRIVATE_KEY,
    beeMode: c.BEE_MODE,
    beeConfigured: !!(c.BEE_API_URL && c.BEE_POSTAGE_BATCH_ID),
    backupSwarmEnabled: c.BACKUP_SWARM_ENABLED,
    channels: {
      telegram: !!(c.TELEGRAM_BOT_TOKEN && c.TELEGRAM_CHAT_ID),
      pagerduty: !!c.PAGERDUTY_ROUTING_KEY,
    },
  };
}
