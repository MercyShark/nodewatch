import { describe, expect, it } from "vitest";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decryptKeystore, keystoreAddress, WrongPasswordError } from "./keystore.js";

/** Build a v3 keystore the way ethers does (scrypt, aes-128-ctr), with small scrypt params for test speed. */
function makeKeystore(privateKey: `0x${string}`, password: string) {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const N = 1024;
  const derived = scryptSync(Buffer.from(password, "utf8"), salt, 32, { N, r: 8, p: 1 });
  const cipher = createCipheriv("aes-128-ctr", derived.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(privateKey.slice(2), "hex")), cipher.final()]);
  const mac = keccak256(Buffer.concat([derived.subarray(16, 32), ciphertext])).slice(2);
  return JSON.stringify({
    version: 3,
    id: "test",
    address: privateKeyToAccount(privateKey).address.slice(2).toLowerCase(),
    crypto: {
      cipher: "aes-128-ctr",
      ciphertext: ciphertext.toString("hex"),
      cipherparams: { iv: iv.toString("hex") },
      kdf: "scrypt",
      kdfparams: { dklen: 32, salt: salt.toString("hex"), n: N, r: 8, p: 1 },
      mac,
    },
  });
}

describe("keystore v3", () => {
  const pk = ("0x" + "42".repeat(32)) as `0x${string}`;
  const json = makeKeystore(pk, "correct horse");

  it("reads the address without a password", () => {
    expect(keystoreAddress(json).toLowerCase()).toBe(privateKeyToAccount(pk).address.toLowerCase());
  });

  it("decrypts with the right password and refuses the wrong one before decrypting", () => {
    expect(decryptKeystore(json, "correct horse")).toBe(pk);
    expect(() => decryptKeystore(json, "wrong")).toThrow(WrongPasswordError);
  });

  it("refuses a tampered ciphertext (MAC mismatch)", () => {
    const ks = JSON.parse(json);
    ks.crypto.ciphertext = ks.crypto.ciphertext.replace(/^../, (h: string) => (h === "00" ? "01" : "00"));
    expect(() => decryptKeystore(JSON.stringify(ks), "correct horse")).toThrow(WrongPasswordError);
  });
});
