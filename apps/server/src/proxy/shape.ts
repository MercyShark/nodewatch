// Query "shapes": an arkiv_query string with its literals replaced, hashed to a stable shape_id.
// Public views only ever see the shape_id, never the text.
import { createHash } from "node:crypto";

/** Replace literal values so that queries differing only in values share a shape. */
export function normalizeShape(query: string): string {
  return query
    .replace(/str\('(?:[^']|'')*'\)/g, "str(?)")
    .replace(/'(?:[^']|'')*'/g, "?")
    .replace(/"(?:[^"\\]|\\.)*"/g, "?")
    .replace(/\b(addr|key|u64|u256|i32|dec|bytes)\(\s*[^)]*\)/g, "$1(?)")
    .replace(/0x[0-9a-fA-F]+/g, "?")
    .replace(/(?<![\w.$])-?\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

export function shapeId(query: string): string {
  return "s_" + createHash("sha256").update(normalizeShape(query)).digest("hex").slice(0, 12);
}

/** Extract method names (and arkiv_query strings) from a JSON-RPC body; null if it is not JSON-RPC. */
export function parseRpcBody(body: Buffer): { methods: string[]; ids: unknown[]; queries: string[]; queryAt: (string | null)[]; batch: boolean } | null {
  if (body.length === 0 || body.length > 5 * 1024 * 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const methods: string[] = [];
  const ids: unknown[] = [];
  const queries: string[] = [];
  const queryAt: (string | null)[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const m = (it as { method?: unknown }).method;
    if (typeof m !== "string") continue;
    methods.push(m.slice(0, 64));
    ids.push((it as { id?: unknown }).id ?? null);
    const params = (it as { params?: unknown }).params;
    const q = m === "arkiv_query" && Array.isArray(params) && typeof params[0] === "string" ? params[0] : null;
    if (q !== null) queries.push(q);
    // The text we keep per call: the arkiv_query string, otherwise the params as JSON (bounded).
    let text: string | null = q;
    if (text === null && params !== undefined) {
      try {
        text = JSON.stringify(params).slice(0, 2000);
      } catch {
        text = null;
      }
    }
    queryAt.push(text);
  }
  return methods.length ? { methods, ids, queries, queryAt, batch: Array.isArray(parsed) } : null;
}
