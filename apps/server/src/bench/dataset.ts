// Synthetic dataset for the slow-query finder: schema nwbench.item, deterministic values from a
// fixed seed, written with executeBatch, 6 h expiry. Writes are signed with BENCH_PRIVATE_KEY and
// sent ONLY to the guarded target (our node or the sandbox).
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, bytes, dec, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import type { Hex } from "viem";
import { walletArkiv } from "../arkiv/client.js";
import { BENCH_SCHEMA_NAME } from "../arkiv/schemas.js";
import type { Config } from "../config.js";
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

/** Seed items [from, to). Returns the number written. */
export async function seed(
  cfg: Config,
  targetUrl: string,
  chainId: number,
  key: string,
  runTag: string,
  from: number,
  to: number,
  onProgress?: (written: number) => void,
  shouldStop?: () => boolean,
): Promise<number> {
  assertBenchTarget(cfg, targetUrl);
  const { account, wallet } = walletArkiv({ ...cfg, EL_RPC_URL: targetUrl, ARKIV_CHAIN_ID: chainId }, key);
  let written = 0;
  for (let i = from; i < to; i += BATCH) {
    if (shouldStop?.()) break;
    const creates = [];
    for (let j = i; j < Math.min(to, i + BATCH); j++) {
      creates.push({ schema: BenchItem, values: itemValues(j, runTag, account.address), expiration: ExpirationTime.fromHours(6) });
    }
    await wallet.executeBatch({ creates });
    written += creates.length;
    onProgress?.(written);
  }
  return written;
}
