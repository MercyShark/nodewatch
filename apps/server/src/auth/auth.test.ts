import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { isLoopback, loadConfig } from "../config.js";
import { testCtx } from "../test/helpers.js";
import { hashPassword, verifyPassword } from "./password.js";
import { originAllowed } from "./rbac.js";
import { Sessions } from "./session.js";
import { allowedDomain, buildMessage, domainsMatch, issueNonce, SiweError, verifySiwe } from "./siwe.js";

describe("siwe", () => {
  const key = generatePrivateKey();
  const acct = privateKeyToAccount(key);
  const ctx = testCtx({ ADMIN_ADDRESSES: acct.address, PUBLIC_ORIGIN: "http://localhost:8080" });

  it("verifies a signed message once (single-use nonce)", async () => {
    const nonce = issueNonce(ctx.db, "localhost:8080");
    const msg = buildMessage(ctx.cfg, "localhost:8080", nonce, acct.address);
    const sig = await acct.signMessage({ message: msg });
    const r = await verifySiwe(ctx.cfg, ctx.db, msg, sig);
    expect(r.role).toBe("admin");
    await expect(verifySiwe(ctx.cfg, ctx.db, msg, sig)).rejects.toThrow(/already used/);
  });

  it("rejects a nonce issued for another domain", async () => {
    const nonce = issueNonce(ctx.db, "localhost:8080");
    const msg = buildMessage(ctx.cfg, "evil.example", nonce, acct.address);
    const sig = await acct.signMessage({ message: msg });
    await expect(verifySiwe(ctx.cfg, ctx.db, msg, sig)).rejects.toThrow(/domain/);
  });

  it("rejects a wrong signer and non-allowlisted addresses", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const nonce = issueNonce(ctx.db, "localhost:8080");
    const msg = buildMessage(ctx.cfg, "localhost:8080", nonce, acct.address);
    await expect(verifySiwe(ctx.cfg, ctx.db, msg, await other.signMessage({ message: msg }))).rejects.toThrow(/signature/);
    const n2 = issueNonce(ctx.db, "localhost:8080");
    const m2 = buildMessage(ctx.cfg, "localhost:8080", n2, other.address);
    await expect(verifySiwe(ctx.cfg, ctx.db, m2, await other.signMessage({ message: m2 }))).rejects.toThrow(/allowlist/);
  });

  it("treats loopback hosts as one domain and returns 403 for non-allowlisted signers", async () => {
    expect(domainsMatch("localhost:5173", "127.0.0.1:8080")).toBe(true);
    expect(domainsMatch("nw.example.com", "localhost:8080")).toBe(false);
    const nonce = issueNonce(ctx.db, "localhost:8080");
    const msg = buildMessage(ctx.cfg, "localhost:5173", nonce, acct.address);
    expect((await verifySiwe(ctx.cfg, ctx.db, msg, await acct.signMessage({ message: msg }))).role).toBe("admin");
    const other = privateKeyToAccount(generatePrivateKey());
    const n2 = issueNonce(ctx.db, "localhost:8080");
    const m2 = buildMessage(ctx.cfg, "localhost:8080", n2, other.address);
    const err = await verifySiwe(ctx.cfg, ctx.db, m2, await other.signMessage({ message: m2 })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiweError);
    expect((err as SiweError).status).toBe(403);
  });

  it("binds nonces only to allowed domains", () => {
    expect(allowedDomain(ctx.cfg, "localhost:5173")).toBe("localhost:5173");
    expect(allowedDomain(ctx.cfg, "attacker.com")).toBe("localhost:8080");
  });
});

describe("sessions", () => {
  it("seals, reads and revokes", async () => {
    const ctx = testCtx();
    const s = new Sessions(ctx.db, "x".repeat(40), false);
    const { cookie, user } = await s.create({ role: "viewer", address: "0xabc", method: "siwe" });
    expect(user.id).toBe("siwe:0xabc");
    const read = await s.read(cookie);
    expect(read?.role).toBe("viewer");
    s.revoke(read!.sid);
    expect(await s.read(cookie)).toBeNull();
    expect(await s.read("tampered")).toBeNull();
  });
});

describe("password", () => {
  it("hashes with argon2id and verifies", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword(undefined, "x")).toBe(false);
  });
});

describe("config + csrf", () => {
  it("refuses the dev bypass on a non-loopback host", () => {
    expect(() => loadConfig({ AUTH_DEV_BYPASS: "1", HOST: "0.0.0.0" })).toThrow(/loopback/);
    expect(loadConfig({ AUTH_DEV_BYPASS: "1", HOST: "127.0.0.1" }).AUTH_DEV_BYPASS).toBe(true);
    expect(isLoopback("::1")).toBe(true);
  });
  it("checks origins", () => {
    const cfg = loadConfig({ PUBLIC_ORIGIN: "https://nw.example.com" });
    expect(originAllowed(cfg, "https://nw.example.com", "nw.example.com", undefined)).toBe(true);
    expect(originAllowed(cfg, "https://evil.com", "nw.example.com", undefined)).toBe(false);
    expect(originAllowed(cfg, undefined, "x", "cross-site")).toBe(false);
    expect(originAllowed(cfg, undefined, "x", undefined)).toBe(true);
    expect(cfg.secureCookies).toBe(true);
  });
});
