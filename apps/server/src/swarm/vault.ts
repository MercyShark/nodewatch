// Encrypted Swarm vault: diagnostic/findings bundles encrypted to recipients' Ethereum keys, stored
// locally, uploaded to Swarm when Bee is configured, and indexed on Arkiv (nodewatch.bundle) when a
// writer key is set. The Swarm reference points to CIPHERTEXT, so it is safe to publish.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import type { Bundle, VaultResponse } from "@nodewatch/shared";
import type { Hex } from "viem";
import { addressOf, walletArkiv } from "../arkiv/client.js";
import { BundleEntity } from "../arkiv/schemas.js";
import { publicConfig } from "../config.js";
import type { Ctx } from "../context.js";
import { errMsg } from "../util/http.js";
import { beeConfigured, uploadToSwarm } from "./bee.js";
import { encryptEnvelope, sha256Hex, SCHEME, type Envelope } from "./ecies.js";
import { getRecipient, listRecipients, RECIPIENT_MESSAGE, recoverRecipient, saveRecipient, checkRecipientMessage } from "./recipients.js";
import { isAllowedPath, redact, redactLines } from "./redact.js";
import { tarGz } from "./tarball.js";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

interface BundleRow {
  id: string;
  kind: Bundle["kind"];
  scheme: Bundle["scheme"];
  recipient: string | null;
  swarm_ref: string | null;
  entity_key: string | null;
  sha256: string;
  size_bytes: number;
  created_at: number;
  status: Bundle["status"];
  error: string | null;
}

const toBundle = (r: BundleRow): Bundle => ({
  id: r.id,
  kind: r.kind,
  scheme: r.scheme,
  recipient: r.recipient,
  swarmRef: r.swarm_ref,
  entityKey: r.entity_key,
  sha256: r.sha256,
  sizeBytes: r.size_bytes,
  createdAt: r.created_at,
  status: r.status,
  error: r.error,
});

export class Vault {
  constructor(private readonly ctx: Ctx) {
    if (ctx.cfg.BEE_MODE === "embedded") ctx.log.info("BEE_MODE=embedded: the bee binary is supervised by the container entrypoint (127.0.0.1:1633)");
  }

  recipientMessage(): string {
    return RECIPIENT_MESSAGE;
  }

  response(): VaultResponse {
    const rows = this.ctx.db.prepare("SELECT * FROM bundles ORDER BY created_at DESC LIMIT 200").all() as BundleRow[];
    return {
      beeConfigured: beeConfigured(this.ctx.cfg),
      beeMode: this.ctx.cfg.BEE_MODE,
      postageBatchId: this.ctx.cfg.BEE_POSTAGE_BATCH_ID ?? null,
      recipients: listRecipients(this.ctx.db).map((r) => ({ address: r.address, label: r.label, addedAt: r.addedAt })),
      bundles: rows.map(toBundle),
    };
  }

  async addRecipient(input: { label: string; signature: string; address?: string; message?: string }): Promise<{ address: string; label: string; addedAt: number }> {
    const label = String(input.label ?? "").trim().slice(0, 64) || "recipient";
    let named: string | undefined = input.address?.toLowerCase();
    if (input.message !== undefined) {
      const inMessage = checkRecipientMessage(input.message);
      if (named && named !== inMessage) throw new Error("the Address line in the message does not match the address field");
      named = inMessage;
    }
    const rec = await recoverRecipient(input.signature as Hex, input.message ?? RECIPIENT_MESSAGE);
    if (named && named !== rec.address) {
      throw new Error(`signature was made by ${rec.address}, not ${named}`);
    }
    const r = saveRecipient(this.ctx.db, { ...rec, label });
    return { address: r.address, label: r.label, addedAt: r.addedAt };
  }

  /** Encrypt to the given addresses (must be registered) or, by default, every registered recipient. */
  encryptToRecipients(data: Buffer, addresses?: string[]): { envelope: Envelope; recipients: string[] } {
    const recips = addresses?.length
      ? addresses.map((a) => {
          const r = getRecipient(this.ctx.db, a);
          if (!r) throw new Error(`${a} is not a registered recipient; add it by signature first`);
          return r;
        })
      : listRecipients(this.ctx.db);
    if (recips.length === 0) throw new Error("no recipients registered; add one by signature before creating an encrypted bundle");
    return { envelope: encryptEnvelope(data, recips), recipients: recips.map((r) => r.address) };
  }

  private async diagnosticFiles(): Promise<{ name: string; data: string }[]> {
    const ctx = this.ctx;
    const s = ctx.state;
    const files: { name: string; data: string }[] = [];
    if (ctx.docker.available().ok) {
      try {
        const refs = await ctx.docker.listNodeContainers();
        for (const ref of refs) {
          try {
            const lines = await ctx.docker.logs(ref.id, 500);
            files.push({ name: `logs/${ref.service}.log`, data: redactLines(lines).join("\n") + "\n" });
          } catch (err) {
            files.push({ name: `logs/${ref.service}.log`, data: `log read failed: ${redact(errMsg(err))}\n` });
          }
        }
      } catch {
        /* docker unavailable: no logs */
      }
    }
    const verdicts = ctx.db.prepare("SELECT ts, code, severity, title, detail FROM verdicts WHERE ts >= ? ORDER BY ts").all(Date.now() - 24 * 3600_000);
    files.push({ name: "verdicts.json", data: JSON.stringify({ current: s.verdict, history: verdicts }, null, 2) });
    files.push({ name: "status.txt", data: redact(statusText(ctx)) });
    return files;
  }

  private commonFiles(): { name: string; data: string }[] {
    const s = this.ctx.state;
    const metrics = {
      at: Date.now(),
      kpis: s.kpis,
      host: s.host,
      el: s.el,
      cl: s.cl,
      tunnel: s.tunnel ? { ...s.tunnel, proxies: s.tunnel.proxies.map((p) => ({ name: p.name, status: p.status, err: redact(p.err) })) } : null,
      containers: s.containers,
      volumes: s.volumes,
      collectors: s.collectors,
    };
    const versions = {
      agent: this.ctx.cfg.AGENT_VERSION,
      el: s.el?.version ?? null,
      cl: s.cl?.version ?? null,
      images: s.containers.list.map((c) => ({ service: c.service, image: c.image })),
      node: process.version,
    };
    return [
      { name: "metrics.json", data: redact(JSON.stringify(metrics, null, 2)) },
      { name: "versions.json", data: JSON.stringify(versions, null, 2) },
    ];
  }

  async createBundle(input: { kind: "diagnostic" | "findings" | "sample"; recipients?: string[]; findings?: unknown }): Promise<Bundle> {
    const ctx = this.ctx;
    const id = randomUUID();
    const createdAt = Date.now();
    let files: { name: string; data: string }[] = this.commonFiles();
    if (input.kind === "diagnostic") files = [...(await this.diagnosticFiles()), ...files, { name: "config.json", data: JSON.stringify(publicConfig(ctx.cfg), null, 2) }];
    if (input.kind === "findings") {
      if (input.findings === undefined) throw new Error("findings bundle needs findings");
      files = [{ name: "findings.json", data: JSON.stringify(input.findings, null, 2) }, files[1]!];
    }
    files.push({ name: "manifest.json", data: JSON.stringify({ id, kind: input.kind, createdAt, files: files.map((f) => f.name) }, null, 2) });
    for (const f of files) if (!isAllowedPath(f.name)) throw new Error(`bundle file not allowlisted: ${f.name}`);
    const tgz = tarGz(files, createdAt);

    let payload: Buffer;
    let scheme: Bundle["scheme"];
    let recipient: string | null;
    if (input.kind === "sample") {
      payload = tgz;
      scheme = "none";
      recipient = null;
    } else {
      const { envelope, recipients } = this.encryptToRecipients(tgz, input.recipients);
      payload = Buffer.from(JSON.stringify(envelope));
      scheme = SCHEME;
      recipient = recipients[0] ?? null;
    }
    const dir = path.join(ctx.cfg.DATA_DIR, "bundles");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const localPath = path.join(dir, input.kind === "sample" ? `${id}.tar.gz` : `${id}.json`);
    writeFileSync(localPath, payload, { mode: 0o600 });

    const row: BundleRow & { local_path: string } = {
      id,
      kind: input.kind,
      scheme,
      recipient,
      swarm_ref: null,
      entity_key: null,
      sha256: sha256Hex(payload),
      size_bytes: payload.length,
      created_at: createdAt,
      status: "local-only",
      error: null,
      local_path: localPath,
    };
    if (beeConfigured(ctx.cfg)) {
      try {
        row.swarm_ref = await uploadToSwarm(ctx.cfg, payload);
        row.status = "uploaded";
      } catch (err) {
        row.status = "failed";
        row.error = `swarm upload: ${errMsg(err)}`.slice(0, 500);
      }
    }
    if (row.swarm_ref && ctx.cfg.BUNDLE_WRITER_PRIVATE_KEY) {
      try {
        row.entity_key = await this.writeEntity(row);
      } catch (err) {
        row.error = `arkiv entity: ${errMsg(err)}`.slice(0, 500);
      }
    }
    ctx.db
      .prepare(
        `INSERT INTO bundles(id, kind, scheme, recipient, swarm_ref, entity_key, sha256, size_bytes, created_at, status, error, local_path)
         VALUES (@id, @kind, @scheme, @recipient, @swarm_ref, @entity_key, @sha256, @size_bytes, @created_at, @status, @error, @local_path)`,
      )
      .run(row);
    ctx.log.info({ id, kind: row.kind, status: row.status, swarmRef: row.swarm_ref }, "bundle created");
    return toBundle(row);
  }

  private async writeEntity(row: BundleRow): Promise<string> {
    const cfg = this.ctx.cfg;
    const { wallet } = walletArkiv(cfg, cfg.BUNDLE_WRITER_PRIVATE_KEY!);
    const provider = cfg.PROVIDER_ADDRESS ?? addressOf(cfg.BUNDLE_WRITER_PRIVATE_KEY)!;
    const r = await wallet.createEntity(
      BundleEntity,
      {
        provider: addr(provider as Hex),
        kind: row.kind,
        recipient: addr((row.recipient ?? ZERO_ADDR) as Hex),
        swarmRef: row.swarm_ref!,
        sha256: row.sha256,
        scheme: row.scheme,
        sizeBytes: u64(row.size_bytes),
      },
      { expiration: ExpirationTime.fromDays(30) },
    );
    return r.entityKey;
  }
}

function statusText(ctx: Ctx): string {
  const s = ctx.state;
  const lines = [
    `verdict: ${s.verdict.code} — ${s.verdict.title}`,
    `el: head=${s.el?.head ?? "?"} peers=${s.el?.peers ?? "?"} syncing=${s.el?.syncing ?? "?"} version=${s.el?.version ?? "?"}`,
    `cl: peers=${s.cl?.peers ?? "?"} sync_distance=${s.cl?.syncDistance ?? "?"} el_offline=${s.cl?.elOffline ?? "?"} version=${s.cl?.version ?? "?"}`,
    `tunnel: reachable=${s.tunnel?.reachable ?? "?"} running=${s.tunnel?.running ?? "?"}`,
    ...s.containers.list.map((c) => `container ${c.service}: running=${c.running} health=${c.health} restarts=${c.restarts} oom=${c.oomKilled}`),
  ];
  return lines.join("\n") + "\n";
}
