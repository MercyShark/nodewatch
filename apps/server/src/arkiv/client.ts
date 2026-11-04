// Arkiv SDK clients bound to OUR node (EL_RPC_URL). Writes are signed locally and sent through it.
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "../config.js";

export function arkivChain(cfg: Config) {
  return defineChain({
    id: cfg.ARKIV_CHAIN_ID,
    name: cfg.ARKIV_NETWORK,
    nativeCurrency: { name: "Golem", symbol: "tGLM", decimals: 18 },
    rpcUrls: { default: { http: [cfg.EL_RPC_URL] } },
    testnet: true,
  });
}

export function publicArkiv(cfg: Config) {
  return createPublicClient({ chain: arkivChain(cfg), transport: http(cfg.EL_RPC_URL, { timeout: 15_000 }) });
}

/** `pollingInterval` (ms) is how often receipts are polled; viem's default is 4 s. */
export function walletArkiv(cfg: Config, privateKey: string, pollingInterval?: number) {
  const account = privateKeyToAccount(privateKey as Hex);
  const wallet = createWalletClient({
    chain: arkivChain(cfg),
    transport: http(cfg.EL_RPC_URL, { timeout: 30_000 }),
    account,
    ...(pollingInterval ? { pollingInterval } : {}),
  });
  return { account, wallet };
}

export function addressOf(privateKey: string | undefined): string | null {
  if (!privateKey) return null;
  try {
    return privateKeyToAccount(privateKey as Hex).address;
  } catch {
    return null;
  }
}
