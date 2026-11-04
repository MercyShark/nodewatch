// Swarm uploads through Bee. BEE_MODE=external uses BEE_API_URL; BEE_MODE=embedded expects the bee
// binary to be supervised by the container entrypoint and reachable on 127.0.0.1:1633.
import { Bee } from "@ethersphere/bee-js";
import type { Config } from "../config.js";

export function beeUrl(cfg: Config): string | null {
  if (cfg.BEE_API_URL) return cfg.BEE_API_URL;
  return cfg.BEE_MODE === "embedded" ? "http://127.0.0.1:1633" : null;
}

export function beeConfigured(cfg: Config): boolean {
  return !!(beeUrl(cfg) && cfg.BEE_POSTAGE_BATCH_ID);
}

/** Upload bytes; returns the Swarm reference as 64 hex chars. Callers only ever upload ciphertext or a sanitized sample. */
export async function uploadToSwarm(cfg: Config, data: Uint8Array): Promise<string> {
  const url = beeUrl(cfg);
  if (!url || !cfg.BEE_POSTAGE_BATCH_ID) throw new Error("Bee is not configured (BEE_API_URL + BEE_POSTAGE_BATCH_ID)");
  const bee = new Bee(url);
  const res = await bee.data.upload(cfg.BEE_POSTAGE_BATCH_ID, data);
  const ref = res.reference as unknown as { toHex?: () => string } | string;
  const hex = typeof ref === "string" ? ref : (ref.toHex?.() ?? String(ref));
  return hex.replace(/^0x/, "");
}

export async function downloadFromSwarm(cfg: Config, ref: string): Promise<Uint8Array> {
  const url = beeUrl(cfg);
  if (!url) throw new Error("Bee is not configured (BEE_API_URL)");
  const res = await fetch(`${url.replace(/\/$/, "")}/bytes/${ref}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Bee download failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
