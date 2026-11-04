// Synthetic dataset for the slow-query finder: schema nwbench.item, deterministic values from a
// fixed seed, written with executeBatch, 6 h expiry. Writes are signed with BENCH_PRIVATE_KEY and
// sent ONLY to the guarded target (our node or the sandbox).
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, bytes, dec, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import type { Hex } from "viem";
import { walletArkiv } from "../arkiv/client.js";
import { BENCH_SCHEMA_NAME, SCHEMA_ATTRIBUTE } from "../arkiv/schemas.js";
import type { Config } from "../config.js";
import { jsonRpc } from "../util/http.js";
import { assertBenchTarget } from "./guard.js";

export const BenchItem = defineSchema(BENCH_SCHEMA_NAME, {
  cat: str().indexed(),
  n: u64().indexed(),
  score: dec().indexed(),
  owner: addr().indexed(),
  tag: str().indexed(),
  run: str().indexed(), // scopes queries to one run's data
  label: str(), // stored only: the non-indexed ORDER BY case
  blob: bytes(),
});

export const SEED = 0x6e77_6265; // "nwbe"
const BATCH = 25;

/** mulberry32: small deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OWNERS = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
] as const;

export function itemValues(i: number, runTag: string, benchAddr: string) {
  const r = prng(SEED + i);
  const blob = new Uint8Array(64 + Math.floor(r() * 448));
  for (let j = 0; j < blob.length; j++) blob[j] = Math.floor(r() * 256);
  return {
    cat: `c${i % 10}`,
    n: u64(i),
    score: dec((Math.floor(r() * 10000) / 100).toFixed(2)),
    owner: addr((i % 4 === 0 ? benchAddr : OWNERS[i % 3]!) as Hex),
    tag: `t${Math.floor(r() * 100)}`,
    run: runTag,
    label: `item-${Math.floor(r() * 1e9).toString(36)}`,
    blob: bytes(blob),
  };
}

export type SeedOptions = {
  /** Batches in flight at once. Each gets its own nonce from one signer, so `$creator` stays the same. */
  parallel?: number;
  /** Receipt polling interval in ms (viem's default of 4 s dominates seeding time on fast chains). */
  pollMs?: number;
  onProgress?: (written: number) => void;
  shouldStop?: () => boolean;
};

/**
 * Seed items [from, to). Returns the number written.
 *
 * Batches are pipelined: up to `parallel` transactions from the same key are in flight, with nonces
 * assigned here instead of by the node, so they can share a block. On the first failure no new
 * batch is started, the in-flight ones are awaited, and the error is thrown. A failed nonce can leave
 * later ones stuck in the target's pool; on the sandbox that pool is thrown away with the container,
 * and on our own node the next run's first batch fills the gap.
 */
export async function seed(
  cfg: Config,
  targetUrl: string,
  chainId: number,
  key: string,
  runTag: string,
  from: number,
  to: number,
  opts: SeedOptions = {},
): Promise<number> {
  assertBenchTarget(cfg, targetUrl);
  const { account, wallet } = walletArkiv({ ...cfg, EL_RPC_URL: targetUrl, ARKIV_CHAIN_ID: chainId }, key, opts.pollMs);
  const parallel = Math.max(1, Math.min(16, Math.floor(opts.parallel ?? 1)));
  let nonce = Number(BigInt(await jsonRpc<string>(targetUrl, "eth_getTransactionCount", [account.address, "pending"], 10_000)));
  let next = from;
  let written = 0;
  let failure: unknown = null;

  // JS is single-threaded: claiming `next` and `nonce` between awaits is atomic.
  const worker = async () => {
    while (failure === null && next < to && !opts.shouldStop?.()) {
      const i = next;
      next = Math.min(to, i + BATCH);
      const n = nonce++;
      const creates = [];
      for (let j = i; j < next; j++) {
        creates.push({ schema: BenchItem, values: itemValues(j, runTag, account.address), expiration: ExpirationTime.fromHours(6) });
      }
      try {
        await wallet.executeBatch({ creates }, { nonce: n });
        written += creates.length;
        opts.onProgress?.(written);
      } catch (err) {
        failure ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  if (failure !== null) throw failure;
  if (written > 0 && !opts.shouldStop?.()) await settled(targetUrl, runTag, from + written);
  return written;
}

/**
 * A receipt can arrive a block before the query index shows its entities. Wait until every item of
 * this run is visible, so the first measurement at a new size does not see a partial dataset.
 */
async function settled(url: string, runTag: string, expected: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await jsonRpc<{ count?: string }>(url, "arkiv_query", [
      `${SCHEMA_ATTRIBUTE} = str('${BENCH_SCHEMA_NAME}') AND run = str('${runTag}')`,
      { select: { key: true, count: true }, limit: "0x1" },
    ], 10_000);
    const seen = r.count ? Number(BigInt(r.count)) : 0;
    if (seen >= expected) return;
    if (Date.now() > deadline) throw new Error(`seeded ${expected} items but only ${seen} are queryable after ${timeoutMs / 1000} s`);
    await new Promise((res) => setTimeout(res, 250));
  }
}
