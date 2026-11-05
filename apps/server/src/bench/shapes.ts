// Shape catalog for the slow-query finder, generated from the query grammar (CLAUDE.md §5.5).
// Each shape renders a raw arkiv_query string; its shapeId hashes the literal-free text plus the
// selection and paging mode, so the id is stable across sizes and runs. Public views show ids only.
import { BENCH_SHAPE_NOTES, type BenchDatasetId, type BenchShapeInfo } from "@nodewatch/shared";
import { shapeId } from "../proxy/shape.js";
import { BENCH_SCHEMA_NAME, SCHEMA_ATTRIBUTE } from "../arkiv/schemas.js";

export type Select = "keys" | "bytes";
export interface ShapeParams {
  size: number;
  runTag: string;
  bench: string; // bench writer address
  lb: string; // LB address (read-only catalog)
}
export interface RenderedShape {
  query: string; // filters + optional ORDER BY
  select: Select;
  limit: number;
  offset?: number;
}
export interface Shape {
  name: string;
  label: string;
  family: string;
  dataset: BenchDatasetId;
  /** Paging comparison: method and depth (percent of the data set). */
  paging?: { method: "offset" | "cursor"; depthPct: number };
  render: (p: ShapeParams) => RenderedShape;
}

const q = (s: string) => `str('${s.replaceAll("'", "''")}')`;
const base = (p: ShapeParams) => `${SCHEMA_ATTRIBUTE} = ${q(BENCH_SCHEMA_NAME)} AND run = ${q(p.runTag)}`;
const cats = (k: number) => Array.from({ length: k }, (_, i) => `cat = ${q(`c${i}`)}`);
// cat = c4 (i % 10 == 4) is compatible with owner = bench (i % 4 == 0): items i ≡ 4 (mod 20) match all five
// terms, so every AND chain returns rows. (c3 + bench owner can never both hold: c3 items are odd.)
const terms = (p: ShapeParams) => [
  `cat = ${q("c4")}`,
  `n > u64(${Math.floor(p.size / 4)})`,
  `score < dec(80)`,
  `tag STARTSWITH ${q("t")}`,
  `owner = addr(${p.bench})`,
];
const keyAt = (pct: number) => `0x${Math.floor((pct / 100) * 255).toString(16).padStart(2, "0")}${"0".repeat(62)}`;

function sh(name: string, label: string, family: string, render: Shape["render"], paging?: Shape["paging"]): Shape {
  const dataset: BenchDatasetId = name.startsWith("mk_") ? "marketplace" : "synthetic";
  return { name, label, family, dataset, render, ...(paging ? { paging } : {}) };
}

export const BENCH_SHAPES: Shape[] = [
  sh("eq_str", "= on indexed str", "equality", (p) => ({ query: `${base(p)} AND cat = ${q("c3")}`, select: "keys", limit: 100 })),
  sh("gt_u64", "> on u64", "range", (p) => ({ query: `${base(p)} AND n > u64(${Math.floor(p.size / 2)})`, select: "keys", limit: 100 })),
  sh("between_u64", "BETWEEN on u64", "range", (p) => ({
    query: `${base(p)} AND n BETWEEN u64(${Math.floor(p.size / 4)}) AND u64(${Math.floor(p.size / 2)})`,
    select: "keys",
    limit: 100,
  })),
  sh("gt_dec", "> on dec", "range", (p) => ({ query: `${base(p)} AND score > dec(50)`, select: "keys", limit: 100 })),
  sh("between_dec", "BETWEEN on dec", "range", (p) => ({ query: `${base(p)} AND score BETWEEN dec(10) AND dec(20)`, select: "keys", limit: 100 })),
  sh("startswith", "STARTSWITH on str", "prefix", (p) => ({ query: `${base(p)} AND tag STARTSWITH ${q("t1")}`, select: "keys", limit: 100 })),
  sh("exists", "EXISTS", "existence", (p) => ({ query: `${base(p)} AND EXISTS(tag)`, select: "keys", limit: 100 })),
  sh("typeof", "TYPEOF", "existence", (p) => ({ query: `${base(p)} AND TYPEOF(n) = u64`, select: "keys", limit: 100 })),
  ...[2, 3, 4, 5].map((k) =>
    sh(`and_${k}`, `AND chain of ${k} terms`, "and", (p) => ({ query: `${base(p)} AND ${terms(p).slice(0, k).join(" AND ")}`, select: "keys", limit: 100 })),
  ),
  ...[2, 4, 8].map((k) =>
    sh(`or_${k}`, `OR fan-out ${k}`, "or", (p) => ({ query: `${base(p)} AND (${cats(k).join(" OR ")})`, select: "keys", limit: 100 })),
  ),
  sh("mixed", "mixed AND/OR with parentheses", "mixed", (p) => ({
    query: `${base(p)} AND (cat = ${q("c1")} OR cat = ${q("c2")}) AND (n < u64(${Math.floor(p.size / 2)}) OR score > dec(90))`,
    select: "keys",
    limit: 100,
  })),
  sh("order_indexed", "ORDER BY indexed u64", "order", (p) => ({ query: `${base(p)} ORDER BY n:u64 DESC`, select: "keys", limit: 100 })),
  sh("order_nonindexed", "ORDER BY non-indexed str", "order", (p) => ({ query: `${base(p)} ORDER BY label:str ASC`, select: "keys", limit: 100 })),
  sh("select_keys", "keys-only selection", "selection", (p) => ({ query: `${base(p)} AND cat = ${q("c5")}`, select: "keys", limit: 100 })),
  sh("select_bytes", "full selection incl. bytes", "selection", (p) => ({ query: `${base(p)} AND cat = ${q("c5")}`, select: "bytes", limit: 100 })),
  sh("owner", "$owner filter", "system", (p) => ({ query: `${base(p)} AND $owner = addr(${p.bench})`, select: "keys", limit: 100 })),
  ...[0, 25, 50, 90].map((d) =>
    sh(`page_offset_d${d}`, `offset paging at ${d} %`, "paging", (p) => ({
      query: `${base(p)} ORDER BY $key:key ASC`,
      select: "keys",
      limit: 50,
      offset: Math.floor((d / 100) * p.size),
    }), { method: "offset", depthPct: d }),
  ),
  ...[0, 25, 50, 90].map((d) =>
    sh(`page_cursor_d${d}`, `key-cursor paging at ${d} %`, "paging", (p) => ({
      query: `${base(p)} AND $key > key(${keyAt(d)}) ORDER BY $key:key ASC`,
      select: "keys",
      limit: 50,
    }), { method: "cursor", depthPct: d }),
  ),
];

/** Read-only shapes over existing marketplace entities (used without a funded bench key). */
export const MARKETPLACE_SHAPES: Shape[] = [
  sh("mk_creator", "$creator filter", "system", (p) => ({ query: `$creator = addr(${p.lb})`, select: "keys", limit: 100 })),
  sh("mk_creator_kind", "$creator AND = str", "and", (p) => ({ query: `$creator = addr(${p.lb}) AND kind = ${q("rpc.agreement")}`, select: "keys", limit: 100 })),
  sh("mk_and_3", "AND chain of 3 terms", "and", (p) => ({
    query: `$creator = addr(${p.lb}) AND kind = ${q("rpc.counter")} AND state = ${q("open")}`,
    select: "keys",
    limit: 100,
  })),
  sh("mk_or", "OR fan-out 3", "or", () => ({ query: `kind = ${q("rpc.counter")} OR kind = ${q("rpc.agreement")} OR kind = ${q("rpc.offer")}`, select: "keys", limit: 100 })),
  sh("mk_startswith", "STARTSWITH on str", "prefix", () => ({ query: `kind STARTSWITH ${q("rpc.")}`, select: "keys", limit: 100 })),
  sh("mk_select_bytes", "full selection incl. bytes", "selection", (p) => ({ query: `$creator = addr(${p.lb})`, select: "bytes", limit: 100 })),
  sh("mk_order", "ORDER BY $key", "order", (p) => ({ query: `$creator = addr(${p.lb}) ORDER BY $key:key ASC`, select: "keys", limit: 100 })),
  ...[0, 50, 90].map((d) =>
    sh(`mk_page_offset_d${d}`, `offset paging at ${d} %`, "paging", (p) => ({
      query: `$creator = addr(${p.lb}) ORDER BY $key:key ASC`,
      select: "keys",
      limit: 20,
      offset: Math.floor((d / 100) * p.size),
    }), { method: "offset", depthPct: d }),
  ),
  ...[0, 50, 90].map((d) =>
    sh(`mk_page_cursor_d${d}`, `key-cursor paging at ${d} %`, "paging", (p) => ({
      query: `$creator = addr(${p.lb}) AND $key > key(${keyAt(d)}) ORDER BY $key:key ASC`,
      select: "keys",
      limit: 20,
    }), { method: "cursor", depthPct: d }),
  ),
];

/** Stable id: literal-free query + selection + paging mode/depth. */
export function idOf(shape: Shape, r: RenderedShape): string {
  const page = shape.paging ? `|page=${shape.paging.method}|depth=d${shape.paging.depthPct}` : "";
  return shapeId(`${r.query} |select=${r.select}|family=${shape.family}${page}`);
}

/** Placeholder parameters: literals are normalised out of the shape id, so ids match real runs. */
const PLACEHOLDER = (lb: string): ShapeParams => ({ size: 5000, runTag: "<run>", bench: "<bench-writer>", lb });

/** Every shape with its stable id, for the catalog and to label stored results. */
export function catalogShapes(lb: string, withTemplate: boolean): BenchShapeInfo[] {
  return [...BENCH_SHAPES, ...MARKETPLACE_SHAPES].map((shape) => {
    const r = shape.render(PLACEHOLDER(lb));
    const note = BENCH_SHAPE_NOTES[shape.name];
    return {
      id: idOf(shape, r),
      name: shape.name,
      label: shape.label,
      family: shape.family,
      dataset: shape.dataset,
      select: r.select,
      limit: r.limit,
      paging: shape.paging ?? null,
      summary: note?.summary ?? shape.label,
      tests: note?.tests ?? "",
      template: withTemplate ? `${r.query}${shape.paging?.method === "offset" ? ` OFFSET ${shape.paging.depthPct} % of size` : ""}` : null,
    };
  });
}
