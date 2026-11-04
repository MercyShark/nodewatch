import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decryptEnvelope, encryptEnvelope, openAtRest, sealAtRest } from "./ecies.js";
import { RECIPIENT_MESSAGE, recoverRecipient } from "./recipients.js";
import { randomBytes } from "node:crypto";

describe("ecies envelope", () => {
  it("round-trips to two recipients recovered from signatures", async () => {
    const keys = [generatePrivateKey(), generatePrivateKey()];
    const recips = await Promise.all(
      keys.map(async (k) => {
        const acct = privateKeyToAccount(k);
        const sig = await acct.signMessage({ message: RECIPIENT_MESSAGE });
        const r = await recoverRecipient(sig);
        expect(r.address).toBe(acct.address.toLowerCase());
        return r;
      }),
    );
    const data = Buffer.from("diagnostic bundle bytes ✓");
    const env = encryptEnvelope(data, recips);
    expect(env.recipients).toHaveLength(2);
    expect(JSON.stringify(env)).not.toContain("diagnostic");
    for (const k of keys) expect(decryptEnvelope(env, k).equals(data)).toBe(true);
    expect(() => decryptEnvelope(env, generatePrivateKey())).toThrow(/not a recipient/);
  });

  it("detects tampering", async () => {
    const k = generatePrivateKey();
    const r = await recoverRecipient(await privateKeyToAccount(k).signMessage({ message: RECIPIENT_MESSAGE }));
    const env = encryptEnvelope(Buffer.from("hello world"), [r]);
    const ct = Buffer.from(env.ciphertext, "base64");
    ct[0] = ct[0]! ^ 1;
    expect(() => decryptEnvelope({ ...env, ciphertext: ct.toString("base64") }, k)).toThrow();
  });

  it("seals text at rest", () => {
    const key = randomBytes(32);
    const s = sealAtRest("cat = str('x')", key);
    expect(s).not.toContain("cat");
    expect(openAtRest(s, key)).toBe("cat = str('x')");
    expect(() => openAtRest(s, randomBytes(32))).toThrow();
  });
});
