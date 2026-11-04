import { createWalletClient, custom, getAddress, type Address } from "viem";
import { createSiweMessage } from "viem/siwe";
import { api, ApiError } from "./api";
import { ARKIV_CHAIN_ID } from "./config";
import type { SessionUser } from "@nodewatch/shared";

export class WalletError extends Error {
  kind: "no-wallet" | "rejected" | "no-account" | "not-allowlisted" | "other";
  constructor(kind: WalletError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

function getProvider(): EthereumProvider {
  const eth = window.ethereum;
  if (!eth) {
    throw new WalletError(
      "no-wallet",
      "No Ethereum wallet found in this browser. Install MetaMask (or another EIP-1193 wallet), or use the password sign-in below.",
    );
  }
  return eth;
}

function isUserRejection(e: unknown): boolean {
  const err = e as { code?: number; cause?: { code?: number }; name?: string; message?: string };
  return (
    err?.code === 4001 ||
    err?.cause?.code === 4001 ||
    err?.name === "UserRejectedRequestError" ||
    /user rejected|denied/i.test(err?.message ?? "")
  );
}

export async function connectWallet(): Promise<Address> {
  const client = createWalletClient({ transport: custom(getProvider()) });
  try {
    const accounts = await client.requestAddresses();
    const first = accounts[0];
    if (!first) throw new WalletError("no-account", "The wallet returned no account. Unlock it and try again.");
    return getAddress(first);
  } catch (e) {
    if (e instanceof WalletError) throw e;
    if (isUserRejection(e)) throw new WalletError("rejected", "You declined the connection request in your wallet.");
    throw new WalletError("other", `Wallet error: ${(e as Error).message ?? String(e)}`);
  }
}

/** personal_sign through viem's wallet client. */
export async function signText(address: Address, message: string): Promise<`0x${string}`> {
  const client = createWalletClient({ account: address, transport: custom(getProvider()) });
  try {
    return await client.signMessage({ account: address, message });
  } catch (e) {
    if (isUserRejection(e)) throw new WalletError("rejected", "You rejected the signature request in your wallet.");
    throw new WalletError("other", `Signing failed: ${(e as Error).message ?? String(e)}`);
  }
}

export type SiweStep = "connecting" | "signing" | "verifying";

export async function signInWithEthereum(onStep?: (s: SiweStep) => void): Promise<SessionUser> {
  onStep?.("connecting");
  const address = await connectWallet();
  const { nonce } = await api<{ nonce: string }>("/auth/siwe/nonce", { method: "POST" });
  const message = createSiweMessage({
    domain: window.location.host,
    uri: window.location.origin,
    address,
    chainId: ARKIV_CHAIN_ID,
    nonce,
    version: "1",
    statement: "Sign in to Nodewatch, the operations console for this Arkiv node.",
    issuedAt: new Date(),
  });
  onStep?.("signing");
  const signature = await signText(address, message);
  onStep?.("verifying");
  try {
    const r = await api<SessionUser | { user: SessionUser }>("/auth/siwe/verify", {
      method: "POST",
      body: { message, signature },
    });
    return "user" in r ? r.user : r;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      throw new WalletError(
        "not-allowlisted",
        `${address} is not on this node's allowlist. Ask the operator to add it to ADMIN_ADDRESSES or VIEWER_ADDRESSES.`,
      );
    }
    throw e;
  }
}

/** Fixed message a vault recipient signs; the server recovers the public key from it. */
export function recipientMessage(label: string, address: string, nonce: string): string {
  return [
    "Nodewatch vault recipient",
    "",
    "I want to receive encrypted Nodewatch bundles for this node.",
    `Label: ${label}`,
    `Address: ${address}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}
