// Execution (JSON-RPC), consensus (Beacon API), tunnel (frpc status) and reference-RPC collectors.
import type { Ctx } from "../context.js";
import { getJson, jsonRpc } from "../util/http.js";

const hexNum = (h: unknown): number | null => (typeof h === "string" && /^0x[0-9a-f]+$/i.test(h) ? Number(BigInt(h)) : null);
const decNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function createElCollector(ctx: Ctx) {
  return async function collectEl(): Promise<void> {
    const url = ctx.cfg.EL_RPC_URL;
    const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v })).catch((e: unknown) => ({ ok: false as const, e }));
    const [chainId, block, syncing, peers, version] = await Promise.all([
      settle(jsonRpc<string>(url, "eth_chainId", [], 4000)),
      settle(jsonRpc<string>(url, "eth_blockNumber", [], 4000)),
      settle(jsonRpc<false | { currentBlock: string; highestBlock: string }>(url, "eth_syncing", [], 4000)),
      settle(jsonRpc<string>(url, "net_peerCount", [], 4000)),
      settle(jsonRpc<string>(url, "web3_clientVersion", [], 4000)),
    ]);
    if (!block.ok && !chainId.ok) {
      ctx.state.el = null;
      throw block.e;
    }
    const now = Date.now();
    const sync = syncing.ok ? syncing.v : null;
    const head = block.ok ? hexNum(block.v) : null;
    ctx.state.el = {
      at: now,
      chainId: chainId.ok ? hexNum(chainId.v) : null,
      head,
      syncing: sync === null ? null : sync !== false,
      syncCurrent: sync && typeof sync === "object" ? hexNum(sync.currentBlock) : null,
      syncHighest: sync && typeof sync === "object" ? hexNum(sync.highestBlock) : null,
      peers: peers.ok ? hexNum(peers.v) : null,
      version: version.ok ? String(version.v) : (ctx.state.el?.version ?? null),
    };
    ctx.tsdb.record("el_head", head, {}, now);
    ctx.tsdb.record("el_peers", ctx.state.el.peers, {}, now);
    ctx.tsdb.record("el_syncing", ctx.state.el.syncing === null ? null : ctx.state.el.syncing ? 1 : 0, {}, now);
    const ref = ctx.state.reference;
    if (head !== null && ref && now - ref.at < 5 * 60_000) {
      // Extrapolate the reference head with 2 s blocks between its (rate-limited) samples.
      const refNow = ref.head + Math.floor((now - ref.at) / 2000);
      ctx.tsdb.record("chain_lag", Math.max(0, refNow - head), {}, now);
    }
  };
}

export function createClCollector(ctx: Ctx) {
  return async function collectCl(): Promise<void> {
    const base = ctx.cfg.CL_API_URL.replace(/\/$/, "");
    const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v })).catch((e: unknown) => ({ ok: false as const, e }));
    type D<T> = { data: T };
    const [syncing, peers, version, finality, health] = await Promise.all([
      settle(getJson<D<{ is_syncing: boolean; is_optimistic?: boolean; el_offline?: boolean; head_slot: string; sync_distance: string }>>(`${base}/eth/v1/node/syncing`, 4000)),
      settle(getJson<D<{ connected: string }>>(`${base}/eth/v1/node/peer_count`, 4000)),
      settle(getJson<D<{ version: string }>>(`${base}/eth/v1/node/version`, 4000)),
      settle(getJson<D<{ finalized: { epoch: string }; current_justified: { epoch: string } }>>(`${base}/eth/v1/beacon/states/head/finality_checkpoints`, 4000)),
      settle(fetch(`${base}/eth/v1/node/health`, { signal: AbortSignal.timeout(4000) }).then((r) => r.status)),
    ]);
    if (!syncing.ok && !peers.ok) {
      ctx.state.cl = null;
      throw syncing.e;
    }
    const now = Date.now();
    const s = syncing.ok ? syncing.v.data : null;
    ctx.state.cl = {
      at: now,
      isSyncing: s ? !!s.is_syncing : null,
      isOptimistic: s ? !!s.is_optimistic : null,
      elOffline: s && typeof s.el_offline === "boolean" ? s.el_offline : null,
      headSlot: s ? decNum(s.head_slot) : null,
      syncDistance: s ? decNum(s.sync_distance) : null,
      peers: peers.ok ? decNum(peers.v.data.connected) : null,
      version: version.ok ? version.v.data.version : (ctx.state.cl?.version ?? null),
      healthStatus: health.ok ? health.v : null,
      finalizedEpoch: finality.ok ? decNum(finality.v.data.finalized?.epoch) : null,
      justifiedEpoch: finality.ok ? decNum(finality.v.data.current_justified?.epoch) : null,
    };
    ctx.tsdb.record("cl_peers", ctx.state.cl.peers, {}, now);
    ctx.tsdb.record("cl_sync_distance", ctx.state.cl.syncDistance, {}, now);
    ctx.tsdb.record("cl_finalized_epoch", ctx.state.cl.finalizedEpoch, {}, now);
  };
}

export function createTunnelCollector(ctx: Ctx) {
  return async function collectTunnel(): Promise<void> {
    const now = Date.now();
    try {
      const body = await getJson<Record<string, { name: string; status: string; err?: string; local_addr?: string; remote_addr?: string }[]>>(
        ctx.cfg.TUNNEL_STATUS_URL,
        4000,
      );
      const proxies = Object.values(body ?? {})
        .flat()
        .filter((p) => p && typeof p === "object")
        .map((p) => ({ name: p.name, status: p.status, err: p.err ?? "", localAddr: p.local_addr ?? "", remoteAddr: p.remote_addr ?? "" }));
      const running = proxies.length > 0 && proxies.every((p) => p.status === "running");
      ctx.state.tunnel = { at: now, reachable: true, running, proxies };
      ctx.tsdb.record("tunnel_up", running ? 1 : 0, {}, now);
    } catch (err) {
      ctx.state.tunnel = { at: now, reachable: false, running: false, proxies: [] };
      ctx.tsdb.record("tunnel_up", 0, {}, now);
      throw err;
    }
  };
}

/** Network head from the public reference RPC, at most once a minute (it is rate limited). */
export function createReferenceCollector(ctx: Ctx) {
  return async function collectReference(): Promise<void> {
    const base = ctx.cfg.ARKIV_REFERENCE_RPC.replace(/\/$/, "");
    const url = ctx.cfg.ARKIV_ACCESS_KEY ? `${base}/${encodeURIComponent(ctx.cfg.ARKIV_ACCESS_KEY)}` : base;
    const head = hexNum(await jsonRpc<string>(url, "eth_blockNumber", [], 8000));
    if (head === null) throw new Error("reference RPC returned no block number");
    const now = Date.now();
    ctx.state.reference = { at: now, head };
    ctx.tsdb.record("ref_head", head, {}, now);
  };
}

/** tGLM balances of the provider and heartbeat addresses (low-gas alert). */
export function createBalancesCollector(ctx: Ctx, heartbeatAddress: () => string | null) {
  return async function collectBalances(): Promise<void> {
    const url = ctx.cfg.EL_RPC_URL;
    const get = async (a: string | null | undefined) => {
      if (!a) return null;
      const wei = await jsonRpc<string>(url, "eth_getBalance", [a, "latest"], 5000);
      return Number(BigInt(wei)) / 1e18;
    };
    const [provider, heartbeat] = await Promise.all([get(ctx.cfg.PROVIDER_ADDRESS), get(heartbeatAddress())]);
    const now = Date.now();
    ctx.state.balances = { at: now, provider, heartbeat };
    ctx.tsdb.record("balance_glm", provider, { who: "provider" }, now);
    ctx.tsdb.record("balance_glm", heartbeat, { who: "heartbeat" }, now);
  };
}
