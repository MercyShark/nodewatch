// Web3 Secret Storage (keystore v3) decryption with Node's own crypto: scrypt or pbkdf2 KDF, aes-128-ctr cipher,
// keccak MAC. This is the same format `ethers` writes (the node kit's `create-key`). The decrypted key is returned
// to the caller and never logged or stored by this module.
import { createDecipheriv, pbkdf2Sync, scryptSync, timingSafeEqual } from "node:crypto";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface KeystoreV3 {
  version: number;
  address?: string;
  crypto: {
    cipher: string;
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: string;
    kdfparams: Record<string, number | string>;
    mac: string;
  };
}

export class WrongPasswordError extends Error {
  constructor() {
    super("wrong keystore password");
  }
}

export function keystoreAddress(json: string): string {
  const ks = JSON.parse(json) as KeystoreV3;
  if (typeof ks.address !== "string") throw new Error("not a keystore file (no address)");
  return ks.address.startsWith("0x") ? ks.address : `0x${ks.address}`;
}

/** Returns the private key, or throws WrongPasswordError. Checks the MAC before decrypting. */
export function decryptKeystore(json: string, password: string): Hex {
  const ks = JSON.parse(json) as KeystoreV3;
  if (ks.version !== 3) throw new Error(`unsupported keystore version ${ks.version}`);
  const c = ks.crypto;
  if (c.cipher !== "aes-128-ctr") throw new Error(`unsupported cipher ${c.cipher}`);
  const p = c.kdfparams;
  const dklen = Number(p.dklen ?? 32);
  const salt = Buffer.from(String(p.salt), "hex");
  let derived: Buffer;
  if (c.kdf === "scrypt") {
    const N = Number(p.n);
    derived = scryptSync(Buffer.from(password.normalize("NFKC"), "utf8"), salt, dklen, { N, r: Number(p.r), p: Number(p.p), maxmem: 256 * N * Number(p.r) + 1024 * 1024 });
  } else if (c.kdf === "pbkdf2") {
    if (p.prf !== "hmac-sha256") throw new Error(`unsupported prf ${p.prf}`);
    derived = pbkdf2Sync(Buffer.from(password.normalize("NFKC"), "utf8"), salt, Number(p.c), dklen, "sha256");
  } else {
    throw new Error(`unsupported kdf ${c.kdf}`);
  }
  const ciphertext = Buffer.from(c.ciphertext, "hex");
  const mac = keccak256(Buffer.concat([derived.subarray(16, 32), ciphertext]));
  const expected = Buffer.from(c.mac.replace(/^0x/, ""), "hex");
  const got = Buffer.from(mac.slice(2), "hex");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new WrongPasswordError();
  const decipher = createDecipheriv("aes-128-ctr", derived.subarray(0, 16), Buffer.from(c.cipherparams.iv, "hex"));
  const key = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const hex = `0x${key.toString("hex")}` as Hex;
  if (ks.address) {
    const want = keystoreAddress(json).toLowerCase();
    if (privateKeyToAccount(hex).address.toLowerCase() !== want) throw new Error("keystore address does not match the decrypted key");
  }
  return hex;
}
