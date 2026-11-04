// Recipients are Ethereum wallets. The recipient signs a fixed message; we recover the public key
// from the signature (no key files exchanged) and store {address, publicKey}.
import { hashMessage, recoverPublicKey, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import type { DB } from "../db/index.js";

export const RECIPIENT_MESSAGE =
  "Nodewatch vault recipient v1: I allow encrypted Nodewatch bundles to be addressed to this wallet.";

export const RECIPIENT_MESSAGE_PREFIX = "Nodewatch vault recipient";

/**
 * The UI builds: "Nodewatch vault recipient" / explanatory sentence / "Label: …" / "Address: …" / "Nonce: …".
 * Accept any message that starts with the prefix and names exactly one Address line; return that address.
 */
export function checkRecipientMessage(message: string): string {
  if (typeof message !== "string" || message.length > 2048 || !message.startsWith(RECIPIENT_MESSAGE_PREFIX)) {
    throw new Error(`message must start with "${RECIPIENT_MESSAGE_PREFIX}"`);
  }
  const lines = message.split(/\r?\n/).map((l) => /^Address:\s*(0x[0-9a-fA-F]{40})\s*$/.exec(l.trim())).filter((m) => m !== null);
  if (lines.length !== 1) throw new Error('message must contain exactly one "Address: 0x…" line');
  return lines[0]![1]!.toLowerCase();
}

export interface Recipient {
  address: string;
  publicKey: string;
  label: string;
  addedAt: number;
}

export async function recoverRecipient(signature: Hex, message: string = RECIPIENT_MESSAGE): Promise<{ address: string; publicKey: string }> {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("signature must be a 65-byte hex string");
  const publicKey = await recoverPublicKey({ hash: hashMessage(message), signature });
  return { address: publicKeyToAddress(publicKey).toLowerCase(), publicKey };
}

export function saveRecipient(db: DB, r: { address: string; publicKey: string; label: string }): Recipient {
  const addedAt = Date.now();
  const address = r.address.toLowerCase();
  db.prepare(
    `INSERT INTO recipients(address, public_key, label, added_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET public_key = excluded.public_key, label = excluded.label`,
  ).run(address, r.publicKey, r.label, addedAt);
  return getRecipient(db, address)!;
}

export function getRecipient(db: DB, address: string): Recipient | null {
  const row = db.prepare("SELECT address, public_key, label, added_at FROM recipients WHERE address = ?").get(address.toLowerCase()) as
    | { address: string; public_key: string; label: string; added_at: number }
    | undefined;
  return row ? { address: row.address, publicKey: row.public_key, label: row.label, addedAt: row.added_at } : null;
}

export function listRecipients(db: DB): Recipient[] {
  return (db.prepare("SELECT address, public_key, label, added_at FROM recipients ORDER BY added_at").all() as {
    address: string;
    public_key: string;
    label: string;
    added_at: number;
  }[]).map((r) => ({ address: r.address, publicKey: r.public_key, label: r.label, addedAt: r.added_at }));
}
