// Node authorisation: the node's provider key signs, once and offline at install time, a statement that names the
// wallet allowed to administer Nodewatch for this node. From then on only that wallet signs in (SIWE); the provider
// key is never used again and never leaves the host. The signed statement is stored as NODE_AUTHORIZATION in .env.
//
// Format (one line, no spaces): <provider>:<admin>:<unix-seconds>:<signature>
// The signed text is authorizationMessage(provider, admin, issuedAt): a fixed, human-readable statement, so a
// wallet shows exactly what is being authorised. It is bound to Nodewatch and to the chain id.
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";

export interface NodeAuthorization {
  provider: string;
  admin: string;
  issuedAt: number;
  signature: Hex;
}

export function authorizationMessage(provider: string, admin: string, issuedAt: number, chainId: number): string {
  return [
    "Nodewatch node authorization",
    "",
    `I run the Arkiv node with provider address ${getAddress(provider)}.`,
    `I authorize the wallet ${getAddress(admin)} to administer Nodewatch for this node.`,
    "",
    `Chain ID: ${chainId}`,
    `Issued At: ${new Date(issuedAt * 1000).toISOString()}`,
  ].join("\n");
}

export function parseAuthorization(value: string): NodeAuthorization {
  const parts = value.trim().split(":");
  if (parts.length !== 4) throw new Error("NODE_AUTHORIZATION must be <provider>:<admin>:<issuedAt>:<signature>");
  const [provider, admin, at, signature] = parts as [string, string, string, string];
  if (!isAddress(provider)) throw new Error("NODE_AUTHORIZATION: provider is not an address");
  if (!isAddress(admin)) throw new Error("NODE_AUTHORIZATION: admin is not an address");
  const issuedAt = Number(at);
  if (!Number.isInteger(issuedAt) || issuedAt <= 0) throw new Error("NODE_AUTHORIZATION: issuedAt must be unix seconds");
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("NODE_AUTHORIZATION: signature must be 65 bytes hex");
  return { provider: getAddress(provider), admin: getAddress(admin), issuedAt, signature: signature as Hex };
}

export function formatAuthorization(a: NodeAuthorization): string {
  return `${a.provider}:${a.admin}:${a.issuedAt}:${a.signature}`;
}

/** Throws unless the signature is the provider's over the exact statement, and the provider matches the node. */
export async function verifyAuthorization(a: NodeAuthorization, chainId: number, providerAddress?: string | null): Promise<void> {
  if (providerAddress && getAddress(providerAddress) !== a.provider) {
    throw new Error(`NODE_AUTHORIZATION was signed for provider ${a.provider}, but this node's PROVIDER_ADDRESS is ${getAddress(providerAddress)}`);
  }
  const ok = await verifyMessage({ address: a.provider as Hex, message: authorizationMessage(a.provider, a.admin, a.issuedAt, chainId), signature: a.signature });
  if (!ok) throw new Error("NODE_AUTHORIZATION signature does not verify against the provider address (wrong key, chain id, or edited text)");
}
