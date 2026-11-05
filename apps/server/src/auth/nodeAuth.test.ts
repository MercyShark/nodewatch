import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../config.js";
import { authorizationMessage, formatAuthorization, parseAuthorization, verifyAuthorization } from "./nodeAuth.js";

const provider = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
const admin = "0xb45b9c76a616A3Bf5F63b54254C802F96b04844e";
const CHAIN = 7794095;

async function sign(issuedAt = 1_800_000_000, chainId = CHAIN) {
  const signature = await provider.signMessage({ message: authorizationMessage(provider.address, admin, issuedAt, chainId) });
  return formatAuthorization({ provider: provider.address, admin, issuedAt, signature });
}

describe("node authorization", () => {
  it("round-trips, verifies, and the statement names both addresses", async () => {
    const value = await sign();
    const a = parseAuthorization(value);
    expect(a).toMatchObject({ provider: provider.address, admin, issuedAt: 1_800_000_000 });
    await expect(verifyAuthorization(a, CHAIN, provider.address)).resolves.toBeUndefined();
    const text = authorizationMessage(provider.address, admin, a.issuedAt, CHAIN);
    expect(text).toContain(provider.address);
    expect(text).toContain(admin);
    expect(text).toContain("Chain ID: 7794095");
  });

  it("rejects a different admin, chain, provider, or an edited signature", async () => {
    const a = parseAuthorization(await sign());
    await expect(verifyAuthorization({ ...a, admin: "0x" + "22".repeat(20) }, CHAIN)).rejects.toThrow(/does not verify/);
    await expect(verifyAuthorization(a, 1337)).rejects.toThrow(/does not verify/);
    await expect(verifyAuthorization(a, CHAIN, "0x" + "33".repeat(20))).rejects.toThrow(/signed for provider/);
    // Corrupt a byte inside r: recovery then yields some other address, so the check must fail.
    const flipped = (a.signature.slice(0, 10) + (a.signature[10] === "0" ? "1" : "0") + a.signature.slice(11)) as typeof a.signature;
    await expect(verifyAuthorization({ ...a, signature: flipped }, CHAIN)).rejects.toThrow();
    expect(() => parseAuthorization("nope")).toThrow(/NODE_AUTHORIZATION/);
  });

  it("config: the authorised wallet becomes an admin and the provider address is derived", async () => {
    const cfg = loadConfig({ DATA_DIR: "/tmp/nw-auth-test", NODE_AUTHORIZATION: await sign() });
    expect(cfg.ADMIN_ADDRESSES).toContain(admin.toLowerCase());
    expect(cfg.PROVIDER_ADDRESS?.toLowerCase()).toBe(provider.address.toLowerCase());
    expect(() => loadConfig({ DATA_DIR: "/tmp/nw-auth-test", NODE_AUTHORIZATION: "a:b:c:d" })).toThrow(/NODE_AUTHORIZATION/);
  });
});
