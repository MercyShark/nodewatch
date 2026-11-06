import { profileMessage, validateProfile } from "@nodewatch/shared";
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { RawEntity } from "./rpc.js";
import { verifyProfileEntity } from "./profile.js";

const CHAIN = 7794095;
const provider = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const fields = { name: "Rishabh, Mumbai", country: "IN", contact: "@onerx" };
const issuedAt = 1_793_900_000_000;

async function entity(over: Partial<Record<string, string>> = {}, signer = provider): Promise<RawEntity> {
  const p = provider.address.toLowerCase();
  const signature = await signer.signMessage({ message: profileMessage({ provider: p, chainId: CHAIN, issuedAt, ...fields }) });
  const vals: Record<string, string> = { provider: p, name: fields.name, country: fields.country, contact: fields.contact, issuedAt: String(issuedAt), signature, ...over };
  return { key: "0x01", attributes: Object.fromEntries(Object.entries(vals).map(([k, value]) => [k, { value }])) } as unknown as RawEntity;
}

describe("node profile", () => {
  it("verifies a profile signed by its provider", async () => {
    const p = await verifyProfileEntity(await entity(), CHAIN);
    expect(p).toMatchObject({ ...fields, verified: true, provider: provider.address.toLowerCase() });
  });
  it("rejects a profile signed by someone else", async () => {
    expect(await verifyProfileEntity(await entity({}, other), CHAIN)).toBeNull();
  });
  it("rejects a profile whose fields were changed after signing", async () => {
    expect(await verifyProfileEntity(await entity({ name: "Someone else" }), CHAIN)).toBeNull();
    expect(await verifyProfileEntity(await entity({ country: "US" }), CHAIN)).toBeNull();
  });
  it("rejects a profile signed for another chain", async () => {
    expect(await verifyProfileEntity(await entity(), 1)).toBeNull();
  });
  it("refuses line breaks, so a field cannot forge another line of the signed message", () => {
    expect(validateProfile({ ...fields, name: "Mine\nProvider: 0xabc" })).toMatch(/line breaks/);
    expect(validateProfile({ ...fields, country: "India" })).toMatch(/two-letter/);
    expect(validateProfile({ ...fields, name: "ü".repeat(48) })).toBeNull();
    expect(validateProfile({ ...fields, name: "😀".repeat(40) })).toMatch(/128 bytes|1 to 48/);
    expect(validateProfile(fields)).toBeNull();
  });
});
