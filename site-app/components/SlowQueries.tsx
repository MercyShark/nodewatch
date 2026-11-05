const ROWS = [
  { q: 'WHERE tag = str("eu") OR tag = str("us") OR … ×8 ORDER BY score', p95: "412 ms", runs: "1,240 / day", active: true },
  { q: "WHERE score > dec(0.5) ORDER BY n OFFSET 4000", p95: "286 ms", runs: "310 / day", active: false },
  { q: 'WHERE owner = addr(0x7a…) AND cat STARTSWITH str("ord")', p95: "131 ms", runs: "5,900 / day", active: false },
  { q: 'WHERE cat = str("orders") AND n BETWEEN u64(1) AND u64(500)', p95: "19 ms", runs: "22,000 / day", active: false },
];

/** The queries that are actually slow: statement trimmed, p95, how often it ran. The first row is active. */
export function SlowQueries() {
  return (
    <div className="r-one border border-soft bg-paper">
      <div className="grid grid-cols-[1fr_auto] gap-x-6 border-b border-soft px-4 py-3 text-xs tracking-[0.08em] text-ink/70 sm:grid-cols-[1fr_7rem_8rem] sm:px-5">
        <span>Statement</span>
        <span className="text-right sm:text-left">p95</span>
        <span className="hidden sm:block">Ran</span>
      </div>
      <ol>
        {ROWS.map((r) => (
          <li
            key={r.q}
            className={`grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 px-4 py-4 sm:grid-cols-[1fr_7rem_8rem] sm:px-5 ${
              r.active ? "r-one shadow-one relative bg-paper ring-1 ring-bright" : "border-t border-soft/60"
            }`}
            aria-current={r.active ? "true" : undefined}
          >
            <code className="font-mono min-w-0 truncate text-[14px] text-ink" title={r.q}>
              {r.q}
            </code>
            <span className={`font-mono text-right text-[15px] sm:text-left ${r.active ? "text-action" : "text-ink"}`}>{r.p95}</span>
            <span className="font-mono col-span-2 text-[13px] text-ink/70 sm:col-span-1 sm:text-[15px]">{r.runs}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
