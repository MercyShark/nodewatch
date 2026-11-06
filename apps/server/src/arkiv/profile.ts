// Node profile on Arkiv (schema nodewatch.profile): name, country and contact, chosen by the operator and signed by the
// provider key. Signing is a message signature only (EIP-191): the provider key sends no transaction and pays nothing.
// The entity is written and paid for by the heartbeat key, and lives 30 days, extended weekly while Nodewatch runs.
// Readers (Fleet, or any site) rebuild profileMessage() from the attributes and keep the profile only when the
// signature recovers the `provider` attribute, so a writer cannot name somebody else's node.
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, bytes, u64 } from "@arkiv-network/sdk/schema";
import {
  profileMessage,
  validateProfile,
  type FleetProfile,
  type NodeProfileFields,
  type NodeProfileState,
} from "@nodewatch/shared";
import { hexToBytes, verifyMessage, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ProviderUnlock } from "../autopilot/unlock.js";
import type { Ctx } from "../context.js";
import { getSetting, setSetting } from "../db/index.js";
import { errMsg, jsonRpc } from "../util/http.js";
import { addressOf, publicArkiv, walletArkiv } from "./client.js";
import { arkivQueryAll, attrNum, attrStr, qstr, type RawEntity } from "./rpc.js";
import { PROFILE_SCHEMA_NAME, ProfileEntity, SCHEMA_ATTRIBUTE } from "./schemas.js";

export const PROFILE_QUERY = `${SCHEMA_ATTRIBUTE} = ${qstr(PROFILE_SCHEMA_NAME)}`;
const LIFETIME_DAYS = 30;
const EXTEND_WHEN_DAYS_LEFT = 7;
const BLOCKS_PER_DAY = 43_200; // 2 s blocks

interface Published {
  entityKey: string;
  fields: NodeProfileFields;
  issuedAt: number;
  expiresAtBlock: number | null;
  txHash: string | null;
}

/** AWS region → ISO country, for the suggestion only. Unknown regions suggest nothing. */
const REGION_COUNTRY: Record<string, string> = {
  "ap-south-1": "IN", "ap-south-2": "IN", "us-east-1": "US", "us-east-2": "US", "us-west-1": "US", "us-west-2": "US",
  "ca-central-1": "CA", "ca-west-1": "CA", "sa-east-1": "BR", "eu-west-1": "IE", "eu-west-2": "GB", "eu-west-3": "FR",
  "eu-central-1": "DE", "eu-central-2": "CH", "eu-north-1": "SE", "eu-south-1": "IT", "eu-south-2": "ES",
  "ap-southeast-1": "SG", "ap-southeast-2": "AU", "ap-southeast-3": "ID", "ap-southeast-4": "AU", "ap-southeast-5": "MY",
  "ap-northeast-1": "JP", "ap-northeast-2": "KR", "ap-northeast-3": "JP", "ap-east-1": "HK", "me-south-1": "BH",
  "me-central-1": "AE", "af-south-1": "ZA", "il-central-1": "IL", "mx-central-1": "MX",
};

/** Ask the EC2 instance metadata service (link-local, IMDSv2) for the region. Best effort, ~1 s budget. */
async function detectRegionCountry(): Promise<string | null> {
  const base = "http://169.254.169.254/latest";
  try {
    const t = await fetch(`${base}/api/token`, { method: "PUT", headers: { "X-aws-ec2-metadata-token-ttl-seconds": "60" }, signal: AbortSignal.timeout(800) });
    if (!t.ok) return null;
    const token = await t.text();
    const r = await fetch(`${base}/meta-data/placement/region`, { headers: { "X-aws-ec2-metadata-token": token }, signal: AbortSignal.timeout(800) });
    if (!r.ok) return null;
    return REGION_COUNTRY[(await r.text()).trim()] ?? null;
  } catch {
    return null;
  }
}

/** Verify one profile entity. Returns the profile and its provider, or null when anything does not check out. */
export async function verifyProfileEntity(e: RawEntity, chainId: number): Promise<(FleetProfile & { provider: string }) | null> {
  const provider = (attrStr(e, "provider") ?? "").toLowerCase();
  const fields: NodeProfileFields = { name: attrStr(e, "name") ?? "", country: attrStr(e, "country") ?? "", contact: attrStr(e, "contact") ?? "" };
  const issuedAt = attrNum(e, "issuedAt");
  const signature = attrStr(e, "signature");
  if (!/^0x[0-9a-f]{40}$/.test(provider) || issuedAt === null || !signature || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  if (validateProfile(fields)) return null;
  try {
    const ok = await verifyMessage({ address: provider as Hex, message: profileMessage({ provider, chainId, issuedAt, ...fields }), signature: signature as Hex });
    return ok ? { ...fields, provider, issuedAt, verified: true } : null;
  } catch {
    return null;
  }
}

export class ProfileService {
  private suggested: string | null = null;
  private cache: { at: number; value: Map<string, FleetProfile> } | null = null;
  readonly writer: string | null;

  constructor(
    private readonly ctx: Ctx,
    private readonly unlock: ProviderUnlock,
  ) {
    this.writer = addressOf(ctx.cfg.HEARTBEAT_PRIVATE_KEY);
    void detectRegionCountry().then((c) => (this.suggested = c));
  }

  private get draft(): NodeProfileFields | null {
    return getSetting<NodeProfileFields | null>(this.ctx.db, "profileDraft", null);
  }
  private get published(): Published | null {
    return getSetting<Published | null>(this.ctx.db, "profilePublished", null);
  }

  /** The provider this node runs for: the keystore's address, which must match PROVIDER_ADDRESS when both are set. */
  private provider(): string | null {
    const fromKey = this.unlock.address?.toLowerCase() ?? null;
    const fromCfg = this.ctx.cfg.PROVIDER_ADDRESS?.toLowerCase() ?? null;
    if (fromKey && fromCfg && fromKey !== fromCfg) return null;
    return fromKey ?? fromCfg;
  }

  private blocker(): string | null {
    if (!this.ctx.cfg.HEARTBEAT_PRIVATE_KEY || !this.writer) return "HEARTBEAT_PRIVATE_KEY is not set: the heartbeat key pays for the profile write";
    const p = this.provider();
    if (!p) return this.unlock.address && this.ctx.cfg.PROVIDER_ADDRESS ? "the keystore address does not match PROVIDER_ADDRESS" : "no provider keystore found";
    if (this.writer.toLowerCase() === p) return "the heartbeat key is the provider key; use a separate hot key";
    if (!this.unlock.unlocked) return "unlock the provider key first (Pool → Autopilot); it signs the profile, it never sends a transaction";
    return null;
  }

  async state(): Promise<NodeProfileState> {
    const pub = this.published;
    let verified = false;
    let expiresAtBlock = pub?.expiresAtBlock ?? null;
    if (pub) {
      try {
        const e = await this.fetchEntity(pub.entityKey);
        if (e) {
          verified = !!(await verifyProfileEntity(e, this.ctx.cfg.ARKIV_CHAIN_ID));
          expiresAtBlock = e.expiresAt ?? expiresAtBlock;
        } else expiresAtBlock = null;
      } catch {
        /* chain unreachable: show what we last wrote */
      }
    }
    const reason = this.blocker();
    return {
      draft: this.draft,
      suggestedCountry: this.suggested,
      provider: this.provider(),
      keyUnlocked: this.unlock.unlocked,
      writer: this.writer,
      canPublish: reason === null && !!this.draft,
      reason: reason ?? (this.draft ? null : "save a name and country first"),
      published: pub ? { entityKey: pub.entityKey, fields: pub.fields, issuedAt: pub.issuedAt, expiresAtBlock, verified, txHash: pub.txHash } : null,
    };
  }

  saveDraft(f: NodeProfileFields): void {
    const fields = { name: f.name.trim(), country: f.country.trim().toUpperCase(), contact: f.contact.trim() };
    const err = validateProfile(fields);
    if (err) throw new Error(err);
    setSetting(this.ctx.db, "profileDraft", fields);
  }

  private async fetchEntity(key: string): Promise<RawEntity | null> {
    const page = await arkivQueryAll(this.ctx.cfg.EL_RPC_URL, `${PROFILE_QUERY} AND $key = key(${key})`, 1, {
      select: { key: true, creator: true, expiresAt: true, attributes: true },
    });
    return page.entities[0] ?? null;
  }

  private async alive(key: string): Promise<boolean> {
    const e = await jsonRpc<unknown>(this.ctx.cfg.EL_RPC_URL, "arkiv_getEntity", [key], 8000);
    return e !== null && e !== undefined;
  }

  /** Sign the draft with the provider key (in memory) and write it with the heartbeat key. */
  async publish(): Promise<{ entityKey: string; txHash: string }> {
    const reason = this.blocker();
    if (reason) throw new Error(reason);
    const fields = this.draft;
    if (!fields) throw new Error("save a name and country first");
    const err = validateProfile(fields);
    if (err) throw new Error(err);
    const provider = this.provider()!;
    const issuedAt = Date.now();
    const message = profileMessage({ provider, chainId: this.ctx.cfg.ARKIV_CHAIN_ID, issuedAt, ...fields });
    const signature = await this.unlock.use((k) => privateKeyToAccount(k).signMessage({ message }));
    // Check our own signature before spending gas on it.
    if (!(await verifyMessage({ address: provider as Hex, message, signature }))) throw new Error("the signature did not verify; nothing was written");

    const values = {
      provider: addr(provider as Hex),
      country: fields.country,
      name: fields.name,
      contact: fields.contact,
      issuedAt: u64(issuedAt),
      signature: bytes(hexToBytes(signature)),
      agentVersion: this.ctx.cfg.AGENT_VERSION.slice(0, 64),
    };
    const { wallet } = walletArkiv(this.ctx.cfg, this.ctx.cfg.HEARTBEAT_PRIVATE_KEY!);
    const expiration = ExpirationTime.fromDays(LIFETIME_DAYS);
    let key = this.published?.entityKey ?? null;
    if (key && !(await this.alive(key))) key = null;
    let txHash: string;
    if (!key) {
      const r = await wallet.createEntity(ProfileEntity, values, { expiration });
      key = r.entityKey;
      txHash = r.txHash;
    } else {
      const r = await wallet.executeBatch({
        patches: [{ schema: ProfileEntity, entityKey: key as Hex, set: values }],
        extensions: [{ entityKey: key as Hex, expiration }],
      });
      txHash = r.txHash;
    }
    const receipt = await publicArkiv(this.ctx.cfg).getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== "success") throw new Error(`profile write reverted (tx ${txHash})`);
    const pub: Published = { entityKey: key, fields, issuedAt, expiresAtBlock: Number(receipt.blockNumber) + LIFETIME_DAYS * BLOCKS_PER_DAY, txHash };
    setSetting(this.ctx.db, "profilePublished", pub);
    this.cache = null;
    return { entityKey: key, txHash };
  }

  /** Daily job: extend the published profile when under a week is left. Same content, no new signature needed. */
  async keepAlive(): Promise<void> {
    const pub = this.published;
    const head = this.ctx.state.el?.head ?? null;
    if (!pub || !this.ctx.cfg.HEARTBEAT_PRIVATE_KEY || head === null) return;
    const e = await this.fetchEntity(pub.entityKey);
    if (!e?.expiresAt) return; // expired: the next publish creates it again
    if (e.expiresAt - head > EXTEND_WHEN_DAYS_LEFT * BLOCKS_PER_DAY) return;
    const { wallet } = walletArkiv(this.ctx.cfg, this.ctx.cfg.HEARTBEAT_PRIVATE_KEY);
    const r = await wallet.executeBatch({ extensions: [{ entityKey: pub.entityKey as Hex, expiration: ExpirationTime.fromDays(LIFETIME_DAYS) }] });
    setSetting(this.ctx.db, "profilePublished", { ...pub, expiresAtBlock: head + LIFETIME_DAYS * BLOCKS_PER_DAY, txHash: r.txHash });
    this.ctx.log.info({ entityKey: pub.entityKey, txHash: r.txHash }, "node profile extended");
  }

  /** Every live profile whose signature verifies, newest per provider. Cached for a minute. */
  async verifiedByProvider(): Promise<Map<string, FleetProfile>> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.value;
    const out = new Map<string, FleetProfile>();
    try {
      const page = await arkivQueryAll(this.ctx.cfg.EL_RPC_URL, PROFILE_QUERY, 500, { select: { key: true, creator: true, expiresAt: true, attributes: true } });
      for (const e of page.entities) {
        const p = await verifyProfileEntity(e, this.ctx.cfg.ARKIV_CHAIN_ID);
        if (!p) continue;
        const cur = out.get(p.provider);
        if (!cur || p.issuedAt > cur.issuedAt) out.set(p.provider, { name: p.name, country: p.country, contact: p.contact, issuedAt: p.issuedAt, verified: true });
      }
    } catch (err) {
      this.ctx.log.warn({ err: errMsg(err) }, "reading node profiles failed");
    }
    this.cache = { at: Date.now(), value: out };
    return out;
  }
}
