import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { pino } from "pino";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import type { Ctx } from "../context.js";
import { openDb } from "../db/index.js";
import { AllowlistedDocker } from "../docker/client.js";
import { Bus, initialState } from "../state.js";
import { decryptEnvelope } from "../swarm/ecies.js";
import { RECIPIENT_MESSAGE } from "../swarm/recipients.js";
import { Vault } from "../swarm/vault.js";
import { Tsdb } from "../tsdb/index.js";
import { Backups, NO_OPERATOR } from "./index.js";

function makeCtx(extra: Record<string, string> = {}): Ctx {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nw-backup-test-"));
  const kit = path.join(dir, "kit");
  mkdirSync(path.join(kit, "secrets"), { recursive: true });
  writeFileSync(path.join(kit, ".env"), "NETWORK=rabdi\n");
  writeFileSync(path.join(kit, "secrets", "provider.keystore"), '{"crypto":"fake"}');
  const cfg = loadConfig({ DATA_DIR: path.join(dir, "data"), NODE_KIT_DIR: kit, DOCKER_SOCKET: path.join(dir, "no.sock"), SESSION_SECRET: "x".repeat(40), ...extra });
  const db = openDb(cfg.DATA_DIR);
  return { cfg, db, tsdb: new Tsdb(db), state: initialState(), bus: new Bus(), docker: new AllowlistedDocker(cfg.DOCKER_SOCKET, "p", "img"), log: pino({ level: "silent" }) };
}

describe("backups", () => {
  it("refuses to back up keys without an operator recipient", async () => {
    const ctx = makeCtx();
    const b = new Backups(ctx, new Vault(ctx));
    const items = await b.run();
    expect(items.every((i) => !i.ok)).toBe(true);
    expect(items[0]!.error).toBe(NO_OPERATOR);
    expect(b.response().targets.map((t) => t.name)).toEqual(["local", "swarm"]);
  });

  it("encrypts to the operator and test-restores", async () => {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const ctx = makeCtx({ OPERATOR_RECIPIENT_ADDRESS: acct.address });
    const vault = new Vault(ctx);
    await vault.addRecipient({ label: "operator", signature: await acct.signMessage({ message: RECIPIENT_MESSAGE }) });
    const b = new Backups(ctx, vault);
    const items = await b.run();
    expect(items.map((i) => [i.kind, i.target, i.ok])).toEqual([["keys-config", "local", true], ["nodewatch-db", "local", true]]);
    const keys = items[0]!;
    const raw = readFileSync(keys.location, "utf8");
    expect(raw).not.toContain("fake");
    expect(raw).not.toContain("NETWORK");
    const tar = gunzipSync(decryptEnvelope(JSON.parse(raw), pk)).toString("latin1");
    expect(tar).toContain("secrets/provider.keystore");
    expect((await b.testRestore(keys.id)).ok).toBe(true);
    expect(await b.testRestore(items[1]!.id, pk)).toMatchObject({ ok: true });
    expect((await b.testRestore(keys.id, generatePrivateKey())).ok).toBe(false);
  });
});

describe("vault", () => {
  it("creates local-only encrypted and sample bundles", async () => {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const ctx = makeCtx();
    const vault = new Vault(ctx);
    await expect(vault.createBundle({ kind: "diagnostic" })).rejects.toThrow(/no recipients/);
    await vault.addRecipient({ label: "arkiv", signature: await acct.signMessage({ message: RECIPIENT_MESSAGE }), address: acct.address });
    const b = await vault.createBundle({ kind: "diagnostic" });
    expect(b).toMatchObject({ kind: "diagnostic", scheme: "ecies-secp256k1-v1", status: "local-only", swarmRef: null, entityKey: null, recipient: acct.address.toLowerCase() });
    const s = await vault.createBundle({ kind: "sample" });
    expect(s).toMatchObject({ scheme: "none", recipient: null });
    const r = vault.response();
    expect(r.bundles).toHaveLength(2);
    expect(r.beeConfigured).toBe(false);
    expect(r.recipients[0]!.label).toBe("arkiv");
  });
});
