import { describe, expect, it } from "vitest";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ProviderLockedError, ProviderUnlock, WrongPasswordError } from "./unlock.js";

function keystoreFile(privateKey: `0x${string}`, password: string): string {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const derived = scryptSync(Buffer.from(password, "utf8"), salt, 32, { N: 1024, r: 8, p: 1 });
  const cipher = createCipheriv("aes-128-ctr", derived.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(privateKey.slice(2), "hex")), cipher.final()]);
  const json = JSON.stringify({
    version: 3,
    address: privateKeyToAccount(privateKey).address.slice(2).toLowerCase(),
    crypto: {
      cipher: "aes-128-ctr",
      ciphertext: ciphertext.toString("hex"),
      cipherparams: { iv: iv.toString("hex") },
      kdf: "scrypt",
      kdfparams: { dklen: 32, salt: salt.toString("hex"), n: 1024, r: 8, p: 1 },
      mac: keccak256(Buffer.concat([derived.subarray(16, 32), ciphertext])).slice(2),
    },
  });
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "nw-ks-")), "provider-key.json");
  writeFileSync(file, json, { mode: 0o600 });
  return file;
}

describe("provider unlock", () => {
  const pk = ("0x" + "77".repeat(32)) as `0x${string}`;
  const addr = privateKeyToAccount(pk).address;

  it("knows the address while locked, refuses use, unlocks with the password, locks again", () => {
    const u = new ProviderUnlock(keystoreFile(pk, "pw"));
    expect(u.address?.toLowerCase()).toBe(addr.toLowerCase());
    expect(u.unlocked).toBe(false);
    expect(() => u.use(() => 1)).toThrow(ProviderLockedError);
    expect(() => u.unlock("nope")).toThrow(WrongPasswordError);
    expect(u.unlocked).toBe(false);
    expect(u.unlock("pw")).toBe(addr);
    expect(u.unlocked).toBe(true);
    expect(u.use((k) => k)).toBe(pk);
    u.lock();
    expect(u.unlocked).toBe(false);
  });

  it("reports a missing keystore instead of throwing", () => {
    const u = new ProviderUnlock("/nonexistent/provider-key.json");
    expect(u.address).toBeNull();
    expect(u.keystoreError).toMatch(/cannot read the provider keystore/);
  });
});
