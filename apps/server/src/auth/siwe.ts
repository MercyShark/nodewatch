// Sign-In with Ethereum using viem's SIWE helpers. Nonces are single-use, expire after 10 minutes,
// and are bound to the domain they were issued for. Signatures are verified for EOAs.
import type { Role } from "@nodewatch/shared";
import { getAddress, verifyMessage, type Hex } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import type { Config } from "../config.js";
import type { DB } from "../db/index.js";

export const NONCE_TTL_MS = 10 * 60_000;
export const SIWE_STATEMENT = "Sign in to Nodewatch, the operations console for this Arkiv node.";

export class SiweError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
  }
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Exact match, or both loopback (SSM port forward / Vite dev proxy rewrite the port or host). */
export function domainsMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase() || (LOOPBACK_HOST.test(a) && LOOPBACK_HOST.test(b));
}

export function roleFor(cfg: Config, address: string): Role | null {
  const a = address.toLowerCase();
  if (cfg.ADMIN_ADDRESSES.includes(a)) return "admin";
  if (cfg.VIEWER_ADDRESSES.includes(a)) return "viewer";
  return null;
}

/** Domains a nonce may be issued for: the PUBLIC_ORIGIN host, or loopback hosts (SSM port forward / dev). */
export function allowedDomain(cfg: Config, host: string | undefined): string {
  const publicHost = new URL(cfg.PUBLIC_ORIGIN).host;
  if (!host) return publicHost;
  const h = host.toLowerCase();
  if (h === publicHost.toLowerCase()) return host;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h)) return host;
  return publicHost;
}

export function issueNonce(db: DB, domain: string, now = Date.now()): string {
  const nonce = generateSiweNonce();
  db.prepare("INSERT INTO siwe_nonces(nonce, domain, created_at) VALUES (?, ?, ?)").run(nonce, domain, now);
  db.prepare("DELETE FROM siwe_nonces WHERE created_at < ?").run(now - 24 * 3600_000);
  return nonce;
}

export function buildMessage(cfg: Config, domain: string, nonce: string, address: string, now = new Date()): string {
  const scheme = domain.startsWith("localhost") || domain.startsWith("127.") ? "http" : new URL(cfg.PUBLIC_ORIGIN).protocol.replace(":", "");
  return createSiweMessage({
    domain,
    address: getAddress(address),
    statement: SIWE_STATEMENT,
    uri: `${scheme}://${domain}`,
    version: "1",
    chainId: cfg.ARKIV_CHAIN_ID,
    nonce,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + NONCE_TTL_MS),
  });
}

export async function verifySiwe(cfg: Config, db: DB, message: string, signature: string, now = new Date()): Promise<{ address: string; role: Role }> {
  if (typeof message !== "string" || message.length > 4096) throw new SiweError("invalid message");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new SiweError("invalid signature");
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !parsed.nonce || !parsed.domain) throw new SiweError("message is missing address, nonce or domain");
  const row = db.prepare("SELECT domain, created_at, used_at FROM siwe_nonces WHERE nonce = ?").get(parsed.nonce) as
    | { domain: string; created_at: number; used_at: number | null }
    | undefined;
  if (!row) throw new SiweError("unknown nonce");
  if (row.used_at) throw new SiweError("nonce already used");
  if (now.getTime() - row.created_at > NONCE_TTL_MS) throw new SiweError("nonce expired");
  if (!domainsMatch(row.domain, parsed.domain)) throw new SiweError("domain mismatch");
  if (!validateSiweMessage({ message: parsed, domain: parsed.domain, nonce: parsed.nonce, time: now })) {
    throw new SiweError("message is not valid now (expired, not yet valid, or wrong domain)");
  }
  // Single use: consume before verifying the signature so a failed attempt also burns the nonce.
  const consumed = db.prepare("UPDATE siwe_nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL").run(now.getTime(), parsed.nonce);
  if (consumed.changes !== 1) throw new SiweError("nonce already used");
  const ok = await verifyMessage({ address: parsed.address, message, signature: signature as Hex });
  if (!ok) throw new SiweError("signature does not match the address");
  const role = roleFor(cfg, parsed.address);
  if (!role) throw new SiweError("this address is not on the admin or viewer allowlist", 403);
  return { address: getAddress(parsed.address), role };
}
