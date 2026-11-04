import { describe, expect, it } from "vitest";
import { isAllowedPath, redact } from "./redact.js";

describe("redact", () => {
  it("removes labelled private keys", () => {
    const pk = "0x" + "ab".repeat(32);
    expect(redact(`private_key: ${pk}`)).not.toContain(pk.slice(2));
    expect(redact(`HEARTBEAT_PRIVATE_KEY=${pk}`)).toBe("HEARTBEAT_PRIVATE_KEY=[REDACTED]");
  });
  it("removes frpc tokens", () => {
    expect(redact('auth.token = "s3cr3t-frp-token"')).not.toContain("s3cr3t");
    expect(redact("token = abcdef123456")).toBe("token = [REDACTED]");
    expect(redact('meta_token="xyz987"')).not.toContain("xyz987");
  });
  it("removes URL credentials and Arkiv access keys", () => {
    expect(redact("connecting to https://alice:hunter2@example.com/rpc")).toBe("connecting to https://[REDACTED]@example.com/rpc");
    expect(redact("rpc https://rpc.rabdi.db-chain.testnet.arkiv.network/AbCdEf123456789")).not.toContain("AbCdEf123456789");
  });
  it("removes bearer tokens, JWTs, AWS keys, Telegram tokens, Slack webhooks", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop")).toContain("Bearer [REDACTED]");
    expect(redact("jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw")).not.toContain("eyJ");
    expect(redact("key AKIAABCDEFGHIJKLMNOP")).not.toContain("AKIA");
    expect(redact("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawZ")).toBe("[REDACTED]");
    expect(redact("https://hooks.slack.com/services/T000/B000/XXXX")).not.toContain("XXXX");
  });
  it("leaves normal log lines unchanged", () => {
    const line = "2026-11-04T14:23:36Z INFO Block added to canonical chain number=208279 hash=0x" + "cd".repeat(32);
    expect(redact(line)).toBe(line);
    expect(redact("Synced head_slot=12345 peers=10")).toBe("Synced head_slot=12345 peers=10");
  });
});

describe("isAllowedPath", () => {
  it("refuses secrets and config", () => {
    for (const p of [".env", "node/.env", ".env.local", "secrets/key.json", "frpc.toml", "keystore/UTC--2026", "../logs/execution.log"]) {
      expect(isAllowedPath(p)).toBe(false);
    }
  });
  it("allows the bundle allowlist", () => {
    expect(isAllowedPath("logs/execution.log")).toBe(true);
    expect(isAllowedPath("metrics.json")).toBe(true);
    expect(isAllowedPath("random.txt")).toBe(false);
  });
});
