// Raw `arkiv_query` JSON-RPC (read side). Verified format: params [queryString, {select, limit, offset}]
// → {data: RpcEntity[], blockNumber, cursor?}. Query language: `AND`/`OR`, typed literals such as
// str('x'), addr(0x..), u64(1). A query needs at least one filter.
import { hexToString } from "viem";
import { jsonRpc } from "../util/http.js";

export interface RawAttr {
  type: string;
  value: unknown;
}
export interface RawEntity {
  key: string;
  owner: string | null;
  creator: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  expiresAt: number | null;
  attributes: Record<string, RawAttr>;
}
export interface QueryPage {
  entities: RawEntity[];
  blockNumber: number;
  cursor: string | null;
}

export interface QueryOpts {
  select?: Partial<Record<"key" | "owner" | "creator" | "createdAt" | "updatedAt" | "expiresAt" | "attributeSchema", boolean>> & {
    attributes?: boolean | Record<string, boolean>;
  };
  limit?: number;
  offset?: number;
  timeoutMs?: number;
}

const FULL_SELECT = { key: true, owner: true, creator: true, createdAt: true, updatedAt: true, expiresAt: true, attributes: true };

const hex = (v: unknown): number | null => (typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) ? Number(BigInt(v)) : null);

export function decodeEntity(e: Record<string, unknown>): RawEntity {
  const attributes: Record<string, RawAttr> = {};
  for (const a of (e.attributes as { name: string; type: string; value: unknown }[] | undefined) ?? []) {
    attributes[a.name] = { type: a.type, value: a.value };
  }
  return {
    key: String(e.key ?? ""),
    owner: typeof e.owner === "string" ? e.owner : null,
    creator: typeof e.creator === "string" ? e.creator : null,
    createdAt: hex(e.createdAt),
    updatedAt: hex(e.updatedAt),
    expiresAt: hex(e.expiresAt),
    attributes,
  };
}

export async function arkivQuery(url: string, query: string, opts: QueryOpts = {}): Promise<QueryPage> {
  const options: Record<string, unknown> = { select: opts.select ?? FULL_SELECT };
  if (opts.limit !== undefined) options.limit = `0x${Math.max(1, Math.min(100, opts.limit)).toString(16)}`;
  if (opts.offset) options.offset = `0x${opts.offset.toString(16)}`;
  const res = await jsonRpc<{ data: Record<string, unknown>[]; blockNumber: string; cursor?: string }>(
    url,
    "arkiv_query",
    [query, options],
    opts.timeoutMs ?? 8000,
  );
  return {
    entities: (res.data ?? []).map(decodeEntity),
    blockNumber: hex(res.blockNumber) ?? 0,
    cursor: res.cursor ?? null,
  };
}

/** Fetch up to `max` entities by offset paging (100 per page). */
export async function arkivQueryAll(url: string, query: string, max = 500, opts: QueryOpts = {}): Promise<QueryPage> {
  const all: RawEntity[] = [];
  let block = 0;
  for (let offset = 0; offset < max; offset += 100) {
    const page = await arkivQuery(url, query, { ...opts, limit: Math.min(100, max - offset), offset });
    block = page.blockNumber || block;
    all.push(...page.entities);
    if (page.entities.length < 100) break;
  }
  return { entities: all, blockNumber: block, cursor: null };
}

/** Escape a string literal for the query language ('' escapes a quote). */
export const qstr = (s: string) => `str('${s.replaceAll("'", "''")}')`;
export const qaddr = (a: string) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`not an address: ${a}`);
  return `addr(${a})`;
};

export function attrStr(e: RawEntity, name: string): string | null {
  const a = e.attributes[name];
  if (!a) return null;
  return typeof a.value === "string" ? a.value : String(a.value);
}

export function attrNum(e: RawEntity, name: string): number | null {
  const a = e.attributes[name];
  if (!a) return null;
  if (typeof a.value === "number") return a.value;
  if (typeof a.value === "string") {
    if (/^0x[0-9a-f]+$/i.test(a.value)) return Number(BigInt(a.value));
    const n = Number(a.value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Decode a `bytes` attribute holding UTF-8 JSON (marketplace payloads). */
export function attrJson<T = Record<string, unknown>>(e: RawEntity, name = "payload"): T | null {
  const a = e.attributes[name];
  if (!a || typeof a.value !== "string") return null;
  try {
    const text = a.value.startsWith("0x") ? hexToString(a.value as `0x${string}`) : a.value;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
