// Slow-query finder: catalog metadata shared by the server (which renders and runs the shapes) and the
// web app (which explains them). Query text itself is rendered on the server and is admin-only.

export type BenchDatasetId = "synthetic" | "marketplace";
export type BenchTarget = "sandbox" | "readonly" | "own-node";

export interface BenchAttribute {
  name: string;
  type: string;
  indexed: boolean;
  /** How values are distributed: what a query on this attribute will match. */
  values: string;
}

export interface BenchDatasetInfo {
  id: BenchDatasetId;
  title: string;
  /** Entity schema (arkiv.schema) or entity kinds the dataset consists of. */
  schema: string;
  /** Which benchmark targets measure this dataset. */
  targets: BenchTarget[];
  description: string;
  /** How the dataset size is decided. */
  sizing: string;
  writes: string;
  attributes: BenchAttribute[];
}

export interface BenchFamilyInfo {
  id: string;
  label: string;
  description: string;
}

export const SLOW_P95_MS = 250;
export const SLOW_K = 1.2;

export const BENCH_DATASETS: BenchDatasetInfo[] = [
  {
    id: "synthetic",
    title: "Synthetic test entities",
    schema: "nwbench.item",
    targets: ["sandbox", "own-node"],
    description:
      "Entities written by the benchmark itself, with values from a fixed seed so every run builds the same data. Grown step by step (e.g. 500 → 1,000 → 2,500 → 5,000) so each shape is timed at several sizes and its growth factor k can be fitted.",
    sizing: "Chosen per run (preset). Sandbox up to 50,000; own node up to 5,000 (each write is a paid transaction).",
    writes: "Sandbox: free dev gas on a throwaway chain. Own node: real tGLM with a dedicated BENCH_PRIVATE_KEY, 6 h expiry.",
    attributes: [
      { name: "cat", type: "str", indexed: true, values: "c0 … c9, item i gets c(i mod 10): each value matches 10 %" },
      { name: "n", type: "u64", indexed: true, values: "the item number i (0 … size-1): unique, ordered" },
      { name: "score", type: "dec", indexed: true, values: "0.00 … 99.99, uniform random" },
      { name: "owner", type: "addr", indexed: true, values: "the bench writer for 25 % of items, else one of three fixed addresses" },
      { name: "tag", type: "str", indexed: true, values: "t0 … t99, uniform random" },
      { name: "run", type: "str", indexed: true, values: "the run tag: scopes every query to this run's data" },
      { name: "label", type: "str", indexed: false, values: "random text, stored only (the non-indexed ORDER BY case)" },
      { name: "blob", type: "bytes", indexed: false, values: "64 … 512 random bytes (makes full selections heavier)" },
    ],
  },
  {
    id: "marketplace",
    title: "Live marketplace entities",
    schema: "rpc.lb_listing, rpc.offer, rpc.agreement, rpc.counter, rpc.receipt",
    targets: ["readonly"],
    description:
      "The real pool entities that already exist on Rabdi, written by the community load balancer. Nothing is written. There is only one size (however many entities exist), so a read-only run is a latency snapshot of real data, not a scaling fit.",
    sizing: "Fixed: the number of entities the LB has created (counted at the start of the run).",
    writes: "None.",
    attributes: [
      { name: "$creator", type: "addr (system)", indexed: true, values: "the LB address for every entity in this dataset" },
      { name: "kind", type: "str", indexed: true, values: "rpc.lb_listing / rpc.offer / rpc.agreement / rpc.counter / rpc.receipt" },
      { name: "state", type: "str", indexed: true, values: "e.g. open (on counters)" },
      { name: "payload", type: "bytes", indexed: false, values: "JSON payload (price, ports, counts…)" },
    ],
  },
];

export const BENCH_FAMILIES: BenchFamilyInfo[] = [
  { id: "equality", label: "Equality", description: "attr = value on an indexed attribute: the cheapest lookup there is." },
  { id: "range", label: "Range", description: "> / < / BETWEEN on numbers (u64) and decimals (dec)." },
  { id: "prefix", label: "Prefix", description: "STARTSWITH on text: a range scan over the string index." },
  { id: "existence", label: "Existence", description: "EXISTS(attr) and TYPEOF(attr): match on presence or type, not value." },
  { id: "and", label: "AND chains", description: "2 to 5 conditions that must all hold: the engine intersects index results." },
  { id: "or", label: "OR fan-out", description: "2 to 8 alternatives: the engine unions several index lookups." },
  { id: "mixed", label: "Mixed", description: "AND of ORs with parentheses: union and intersection together." },
  { id: "order", label: "Sorting", description: "ORDER BY on an indexed vs a non-indexed attribute." },
  { id: "selection", label: "Selection", description: "Same filter, keys only vs full entities including bytes: the cost of the answer size." },
  { id: "system", label: "System fields", description: "$owner / $creator: filters on fields Arkiv sets itself." },
  { id: "paging", label: "Paging", description: "Fetch a page deep into the results: OFFSET vs a key cursor, at 0 / 25 / 50 / 90 % depth." },
];

/** Plain-language notes per shape name: what it asks, and what it tells us. */
export const BENCH_SHAPE_NOTES: Record<string, { summary: string; tests: string }> = {
  eq_str: { summary: "Items whose category is exactly c3.", tests: "Baseline: a single equality on an indexed string. Should stay flat as data grows." },
  gt_u64: { summary: "Items numbered above half the dataset.", tests: "Open-ended range on an indexed u64; half of all items match." },
  between_u64: { summary: "Items numbered between 25 % and 50 % of the dataset.", tests: "Closed range on an indexed u64; a quarter of items match." },
  gt_dec: { summary: "Items with score above 50.", tests: "Range on an indexed decimal; about half match." },
  between_dec: { summary: "Items with score between 10 and 20.", tests: "Narrow decimal range; about 10 % match." },
  startswith: { summary: "Items whose tag starts with t1.", tests: "Prefix scan on an indexed string (t1, t10 … t19 match)." },
  exists: { summary: "Items that have a tag at all.", tests: "Presence check; every item matches, so it shows the cost of a broad match." },
  typeof: { summary: "Items whose n is stored as a u64.", tests: "Type check; every item matches." },
  and_2: { summary: "Category c4 AND number above 25 %.", tests: "Intersection of two index results." },
  and_3: { summary: "…AND score below 80.", tests: "Three-way intersection." },
  and_4: { summary: "…AND tag starts with t.", tests: "Four-way intersection." },
  and_5: { summary: "…AND owner is the bench writer.", tests: "Five-way intersection; about 5 % of items match all five." },
  or_2: { summary: "Category c0 OR c1.", tests: "Union of two equality lookups (20 % of items)." },
  or_4: { summary: "Category c0 … c3.", tests: "Union of four lookups (40 %)." },
  or_8: { summary: "Category c0 … c7.", tests: "Union of eight lookups (80 %): the widest OR." },
  mixed: { summary: "(c1 OR c2) AND (number below half OR score above 90).", tests: "Unions inside an intersection, with parentheses." },
  order_indexed: { summary: "All items, highest number first.", tests: "Sort on an indexed u64: can the index give the order for free?" },
  order_nonindexed: { summary: "All items, sorted by label.", tests: "Sort on a stored-only string: forces a full sort." },
  select_keys: { summary: "Category c5, keys only.", tests: "Small answer: just the entity keys." },
  select_bytes: { summary: "Category c5, full entities including the blob.", tests: "Large answer: every attribute and 64–512 bytes each. Compare with select_keys." },
  owner: { summary: "Items owned by the bench writer.", tests: "Filter on the system field $owner (25 % match)." },
  page_offset_d0: { summary: "First page of 50, by key, using OFFSET 0.", tests: "Paging baseline." },
  page_offset_d25: { summary: "Page of 50 starting 25 % in, using OFFSET.", tests: "OFFSET must skip a quarter of the results first." },
  page_offset_d50: { summary: "Page of 50 starting halfway, using OFFSET.", tests: "OFFSET skipping half the results." },
  page_offset_d90: { summary: "Page of 50 starting 90 % in, using OFFSET.", tests: "Deep OFFSET: usually the worst case for offset paging." },
  page_cursor_d0: { summary: "First page of 50, by key cursor.", tests: "Cursor paging baseline." },
  page_cursor_d25: { summary: "Page of 50 after a key 25 % through the key space.", tests: "A cursor jumps straight to the position, no skipping." },
  page_cursor_d50: { summary: "Page of 50 after a key halfway through.", tests: "Cursor paging at mid depth." },
  page_cursor_d90: { summary: "Page of 50 after a key 90 % through.", tests: "Deep cursor: should cost the same as the first page." },
  mk_creator: { summary: "Every entity the LB created.", tests: "System-field filter on real marketplace data." },
  mk_creator_kind: { summary: "The LB's rpc.agreement entities.", tests: "$creator AND an indexed string, on real data." },
  mk_and_3: { summary: "The LB's open rpc.counter entities.", tests: "Three-way intersection on real data." },
  mk_or: { summary: "Counters, agreements or offers.", tests: "OR across three entity kinds." },
  mk_startswith: { summary: "Every kind starting with rpc.", tests: "Prefix scan on real data." },
  mk_select_bytes: { summary: "Every LB entity, full payloads.", tests: "Full selection with the JSON payloads." },
  mk_order: { summary: "Every LB entity, sorted by key.", tests: "ORDER BY $key on real data." },
  mk_page_offset_d0: { summary: "First page of 20 with OFFSET.", tests: "Offset paging baseline on real data." },
  mk_page_offset_d50: { summary: "Page of 20 halfway in, with OFFSET.", tests: "Offset paging at mid depth." },
  mk_page_offset_d90: { summary: "Page of 20 90 % in, with OFFSET.", tests: "Deep offset paging on real data." },
  mk_page_cursor_d0: { summary: "First page of 20 by key cursor.", tests: "Cursor paging baseline on real data." },
  mk_page_cursor_d50: { summary: "Page of 20 after a mid key.", tests: "Cursor paging at mid depth." },
  mk_page_cursor_d90: { summary: "Page of 20 after a key 90 % through.", tests: "Deep cursor paging on real data." },
};

export interface PowerFit {
  /** Growth exponent: p95 ∝ size^k. */
  k: number;
  /** p95 = a · size^k (ms). */
  a: number;
  /** Goodness of fit in log space, 0..1 (1 = the points lie on the line). Null with < 3 points. */
  r2: number | null;
}

/** Least-squares fit of log(y) = log(a) + k·log(x). Needs ≥ 2 distinct x; otherwise null. */
export function fitPower(points: { x: number; y: number }[]): PowerFit | null {
  const pts = points.filter((p) => p.x > 0 && p.y > 0).map((p) => ({ x: Math.log(p.x), y: Math.log(p.y) }));
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const k = sxy / sxx;
  const a = Math.exp(my - k * mx);
  const r2 = n < 3 ? null : syy === 0 ? 1 : Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy)));
  return { k, a, r2 };
}

/** Predicted p95 at a size from a fit. Extrapolation: only a hint, never a measurement. */
export const project = (f: PowerFit, size: number) => f.a * size ** f.k;
