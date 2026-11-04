// Envelope encryption to Ethereum keys: random AES-256-GCM key K encrypts the payload; K is wrapped
// per recipient with ECIES (secp256k1, eciesjs). Only a recipient's private key can open it.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { decrypt as eciesDecrypt, encrypt as eciesEncrypt } from "eciesjs";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sessionSecret } from "../auth/session.js";
import type { Config } from "../config.js";

export const SCHEME = "ecies-secp256k1-v1" as const;

export interface Envelope {
  v: 1;
  scheme: typeof SCHEME;
  recipients: { addr: string; wrappedKey: string }[];
  iv: string;
  tag: string;
  ciphertext: string;
}

const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

export function encryptEnvelope(plaintext: Buffer, recipients: { address: string; publicKey: string }[]): Envelope {
  if (recipients.length === 0) throw new Error("at least one recipient is required");
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  const env: Envelope = {
    v: 1,
    scheme: SCHEME,
    recipients: recipients.map((r) => ({
      addr: r.address.toLowerCase(),
      wrappedKey: Buffer.from(eciesEncrypt(strip0x(r.publicKey), key)).toString("hex"),
    })),
    iv: iv.toString("hex"),
    tag: c.getAuthTag().toString("hex"),
    ciphertext: ct.toString("base64"),
  };
  key.fill(0);
  return env;
}

export function isEnvelope(x: unknown): x is Envelope {
  const e = x as Envelope;
  return (
    !!e &&
    e.v === 1 &&
    e.scheme === SCHEME &&
    Array.isArray(e.recipients) &&
    typeof e.iv === "string" &&
    typeof e.tag === "string" &&
    typeof e.ciphertext === "string"
  );
}

export function decryptEnvelope(env: Envelope, privateKeyHex: string): Buffer {
  if (!isEnvelope(env)) throw new Error("not a Nodewatch envelope");
  const pk = (privateKeyHex.startsWith("0x") ? privateKeyHex : `0x${privateKeyHex}`) as Hex;
  const addr = privateKeyToAccount(pk).address.toLowerCase();
  const mine = env.recipients.filter((r) => r.addr.toLowerCase() === addr);
  const candidates = mine.length ? [...mine, ...env.recipients.filter((r) => !mine.includes(r))] : env.recipients;
  for (const r of candidates) {
    let key: Buffer;
    try {
      key = Buffer.from(eciesDecrypt(strip0x(pk), Buffer.from(r.wrappedKey, "hex")));
    } catch {
      continue;
    }
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "hex"));
    d.setAuthTag(Buffer.from(env.tag, "hex"));
    return Buffer.concat([d.update(Buffer.from(env.ciphertext, "base64")), d.final()]);
  }
  throw new Error(`this key (${addr}) is not a recipient of the envelope`);
}

export const sha256Hex = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

// ---- At-rest sealing (bench shape text) ----

export function atRestKey(cfg: Config): Buffer {
  return Buffer.from(hkdfSync("sha256", sessionSecret(cfg), "nodewatch", "bench-at-rest", 32));
}

export function sealAtRest(text: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function openAtRest(sealed: string, key: Buffer): string {
  const [v, iv, tag, ct] = sealed.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("not a sealed value");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}
