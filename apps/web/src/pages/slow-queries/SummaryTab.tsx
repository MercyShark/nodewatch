import { Activity, AlertTriangle, Clock, Database, Gauge, Layers, Sigma, TrendingUp } from "lucide-react";
import type { BenchCatalog } from "@nodewatch/shared";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/table";
import { ChartCard, type QueryState } from "@/charts/ChartCard";
import { RiskScatter } from "@/charts/RiskScatter";
import { RankingBars } from "@/charts/RankingBars";
import { fmtDuration, fmtNum } from "@/lib/format";
import { crossesSlowAt, kWords, ms, type FamilyView, type RunModel, type ShapeView } from "./model";
import { ShapeButton, Stat, TARGETS } from "./parts";

const pctOf = (v: number, of: number) => `${Math.round((v / of) * 100)} %`;

function Narrative({ m, catalog, onOpen }: { m: RunModel; catalog: BenchCatalog | undefined; onOpen: (id: string) => void }) {
  const t = m.totals;
  const slowMs = catalog?.thresholds.slowP95Ms ?? 250;
  const multi = m.sizes.length > 1;
  const ks = m.shapes.map((s) => s.k).filter((k): k is number => k != null);
  const flat = ks.filter((k) => k < 0.3).length;
  const sub = ks.filter((k) => k >= 0.3 && k < 0.8).length;
  const lin = ks.filter((k) => k >= 0.8 && k <= (catalog?.thresholds.slowK ?? 1.2)).length;
  const sup = ks.filter((k) => k > (catalog?.thresholds.slowK ?? 1.2)).length;
  const fastest = t.maxK;
  const cross = fastest ? crossesSlowAt(fastest) : null;
  const perShape = m.run.meta ? m.run.meta.runsPerShape - m.run.meta.warmupRuns : null;
  const link = (s: ShapeView | null) => (s ? <ShapeButton name={s.name} onOpen={() => onOpen(s.id)} slow={s.slow} /> : null);

  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-fg marker:text-muted">
      <li>
        <span className="num">{fmtNum(m.shapes.length)}</span> query shapes measured at <span className="num">{m.sizes.length}</span> dataset size
        {m.sizes.length === 1 ? "" : "s"} (<span className="num">{m.sizes.map((s) => fmtNum(s)).join(" → ")}</span> entities)
        {perShape ? (
          <>
            , <span className="num">{perShape}</span> timed runs each: <span className="num">{fmtNum(t.samples)}</span> queries in total
          </>
        ) : null}
        . Target: {TARGETS[m.run.target]?.label ?? m.run.target}.
      </li>
      <li>
        {t.slow === 0 ? (
          <>
            <span className="font-medium text-ok">No slow shapes.</span>{" "}
          </>
        ) : (
          <>
            <span className="font-medium text-warn">
              {t.slow} slow shape{t.slow === 1 ? "" : "s"}.
            </span>{" "}
          </>
        )}
        {t.worst ? (
          <>
            The slowest at <span className="num">{fmtNum(m.largest)}</span> entities is {link(t.worst)} at{" "}
            <span className="num">{ms(t.worst.largest!.p95Ms)} ms</span> p95, <span className="num">{pctOf(t.worst.largest!.p95Ms, slowMs)}</span> of the{" "}
            <span className="num">{slowMs} ms</span> budget. The typical shape takes <span className="num">{ms(t.medianP95)} ms</span>.
          </>
        ) : null}
      </li>
      {multi ? (
        <li>
          Growth: <span className="num">{flat}</span> flat (k &lt; 0.3), <span className="num">{sub}</span> sub-linear, <span className="num">{lin}</span> about linear,{" "}
          <span className="num">{sup}</span> super-linear (k &gt; {catalog?.thresholds.slowK ?? 1.2}).
          {fastest ? (
            <>
              {" "}
              Fastest-growing: {link(fastest)} with k = <span className="num">{fastest.k?.toFixed(2)}</span>
              {cross ? (
                <>
                  ; if that trend holds it would reach <span className="num">{slowMs} ms</span> at about <span className="num">{fmtNum(Math.round(cross / 1000) * 1000)}</span>{" "}
                  entities{cross > m.largest * 1.5 ? ", well beyond this run, so a larger run would confirm it" : ""}
                </>
              ) : null}
              .
            </>
          ) : null}
        </li>
      ) : (
        <li>One dataset size only, so this run is a latency snapshot: growth factors need two or more sizes.</li>
      )}
      <li>
        <span className="num">{fmtNum(t.errors)}</span> failed queries and <span className="num">{fmtNum(t.zeroRows)}</span> empty answers out of{" "}
        <span className="num">{fmtNum(t.measurements)}</span> measurements
        {t.zeroRows === 0 ? ", so every timing is of a real answer." : ". Empty answers are timed but say little about scaling."}
      </li>
    </ul>
  );
}

export function SummaryTab({
  m,
  catalog,
  safe,
  onOpen,
  state,
}: {
  m: RunModel;
  catalog: BenchCatalog | undefined;
  safe: boolean;
  onOpen: (id: string) => void;
  state: QueryState;
}) {
  const t = m.totals;
  const slowMs = catalog?.thresholds.slowP95Ms ?? 250;
  const slowK = catalog?.thresholds.slowK ?? 1.2;
  const meta = m.run.meta;
  const multi = m.sizes.length > 1;
  const concerns = [...m.shapes].sort((a, b) => b.risk - a.risk).slice(0, 6);

  const famCols: Column<FamilyView>[] = [
    { key: "family", header: "Family", cell: (f) => <span className="text-sm text-fg">{f.label}</span>, sort: (f) => f.label },
    { key: "n", header: "Shapes", align: "right", cell: (f) => fmtNum(f.shapes.length), sort: (f) => f.shapes.length },
    { key: "med", header: "Median p95", align: "right", cell: (f) => `${ms(f.medianP95)} ms`, sort: (f) => f.medianP95 },
    { key: "max", header: "Max p95", align: "right", cell: (f) => `${ms(f.maxP95)} ms`, sort: (f) => f.maxP95 },
    { key: "k", header: "Max k", align: "right", hideBelow: "sm", cell: (f) => (f.maxK == null ? "—" : f.maxK.toFixed(2)), sort: (f) => f.maxK },
    { key: "slow", header: "Slow", align: "right", cell: (f) => fmtNum(f.slow), sort: (f) => f.slow },
  ];
  const timeline = meta
    ? m.sizes.map((size) => ({
        size,
        seed: meta.seed.find((s) => s.size === size),
        measure: meta.measure.find((s) => s.size === size),
      }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Verdict" icon={<Gauge />} value={t.slow === 0 ? "0 slow" : `${t.slow} slow`} tone={t.slow ? "warn" : "ok"} toneText="slow shapes" sub={`of ${m.shapes.length} shapes`} />
        <Stat
          label={`Worst p95 @ ${fmtNum(m.largest)}`}
          icon={<AlertTriangle />}
          value={t.worst ? `${ms(t.worst.largest!.p95Ms)} ms` : "—"}
          tone={t.worst && t.worst.largest!.p95Ms > slowMs ? "warn" : "ok"}
          toneText="over budget"
          sub={t.worst ? `${t.worst.name} · ${pctOf(t.worst.largest!.p95Ms, slowMs)} of ${slowMs} ms` : undefined}
        />
        <Stat label="Median p95" icon={<Activity />} value={`${ms(t.medianP95)} ms`} sub={`at ${fmtNum(m.largest)} entities`} />
        <Stat
          label="Max growth k"
          icon={<TrendingUp />}
          value={multi && t.maxK?.k != null ? t.maxK.k.toFixed(2) : "—"}
          tone={multi && (t.maxK?.k ?? 0) > slowK ? "warn" : "ok"}
          toneText="super-linear"
          sub={multi && t.maxK ? `${t.maxK.name} · ${kWords(t.maxK.k).text.split(":")[0]}` : "needs ≥ 2 sizes"}
        />
        <Stat label="Timed queries" icon={<Sigma />} value={fmtNum(t.samples)} sub={`${fmtNum(t.measurements)} shape × size measurements`} />
        <Stat
          label="Errors / empty"
          icon={<Layers />}
          value={`${fmtNum(t.errors)} / ${fmtNum(t.zeroRows)}`}
          tone={t.errors ? "crit" : t.zeroRows ? "warn" : "ok"}
          toneText={t.errors ? "errors" : "empty answers"}
          sub="failed queries / results with 0 rows"
        />
        <Stat
          label="Dataset"
          icon={<Database />}
          value={`${fmtNum(m.largest)}`}
          sub={meta ? `${meta.dataset === "synthetic" ? "nwbench.item entities" : "marketplace entities"} · ${meta.client?.split("/").slice(0, 2).join("/") ?? "client unknown"}` : "entities at the last step"}
        />
        <Stat
          label="Run time"
          icon={<Clock />}
          value={t.durationMs != null ? fmtDuration(t.durationMs / 1000) : "running"}
          sub={t.seedMs != null ? `seeding ${fmtDuration(t.seedMs / 1000)} · measuring ${fmtDuration((t.measureMs ?? 0) / 1000)}` : "timings recorded from this version on"}
        />
      </div>

      <Card>
        <CardHeader title="What this run says" description="Generated from the measurements. Click a shape to open it in the explorer." />
        <CardBody>
          <Narrative m={m} catalog={catalog} onOpen={onOpen} />
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Risk map"
          description={`How slow a shape is now (→) against how fast it gets worse (↑). The shaded zone is slow: p95 over ${slowMs} ms or k over ${slowK}. Click a point to open the shape.`}
          state={state}
          isEmpty={!multi}
          emptyText="The risk map needs two or more dataset sizes (a growth factor)."
          height={380}
          summary={`${t.slow} of ${m.shapes.length} shapes are in the slow zone.`}
          chart={() => (
            <RiskScatter
              points={m.shapes.filter((s) => s.largest && s.k != null).map((s) => ({ key: s.id, label: s.name, p95: s.largest!.p95Ms, k: s.k!, slow: s.slow }))}
              slowMs={slowMs}
              slowK={slowK}
              height={380}
              onSelect={onOpen}
              format={ms}
            />
          )}
          table={() => (
            <DataTable
              rows={m.shapes}
              rowKey={(s) => s.id}
              caption="Risk map data"
              dense
              maxHeight={380}
              initialSort={{ key: "risk", dir: "desc" }}
              columns={[
                { key: "shape", header: "Shape", cell: (s) => <ShapeButton name={s.name} onOpen={() => onOpen(s.id)} slow={s.slow} />, sort: (s) => s.num },
                { key: "p95", header: "p95 ms", align: "right", cell: (s) => (s.largest ? ms(s.largest.p95Ms) : "—"), sort: (s) => s.largest?.p95Ms ?? 0 },
                { key: "k", header: "k", align: "right", cell: (s) => (s.k == null ? "—" : s.k.toFixed(2)), sort: (s) => s.k },
                { key: "risk", header: "Risk", align: "right", cell: (s) => pctOf(s.risk, 1), sort: (s) => s.risk },
              ]}
            />
          )}
        />
        <Card>
          <CardHeader title="Look at these first" description={`Ranked by risk: the larger of p95 ÷ ${slowMs} ms and k ÷ ${slowK}. 100 % means at the slow line.`} />
          <CardBody>
            <ol className="flex flex-col divide-y divide-border/60">
              {concerns.map((s, i) => (
                <li key={s.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2">
                  <span className="num text-sm text-muted">{i + 1}</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <ShapeButton name={s.name} onOpen={() => onOpen(s.id)} slow={s.slow} />
                    {!safe && s.info ? <span className="min-w-0 truncate text-xs text-muted">{s.info.label}</span> : null}
                  </div>
                  <span className="num text-right text-sm whitespace-nowrap text-fg">
                    {s.largest ? `${ms(s.largest.p95Ms)} ms` : "—"}
                    <span className="ml-2 text-muted">{s.k == null ? "" : `k ${s.k.toFixed(2)}`}</span>
                  </span>
                  <span aria-hidden />
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className={s.risk >= 1 ? "h-full bg-warn" : "h-full bg-primary"} style={{ width: `${Math.min(100, s.risk * 100)}%` }} />
                  </div>
                  <span className="num text-right text-xs text-muted">risk {pctOf(s.risk, 1)}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>

      {!safe && m.families.length ? (
        <ChartCard
          title={`Query families at ${fmtNum(m.largest)} entities`}
          description="Each family groups shapes that ask the same kind of question. Bars: the slowest shape in the family (p95)."
          state={state}
          height={Math.max(260, m.families.length * 26 + 90)}
          chart={() => (
            <RankingBars
              items={[...m.families].sort((a, b) => b.maxP95 - a.maxP95).map((f) => ({ key: f.id, label: f.label, value: f.maxP95, flagged: f.slow > 0 }))}
              threshold={slowMs}
              thresholdLabel={`${slowMs} ms`}
              unit="max p95 ms"
              format={ms}
              height={Math.max(260, m.families.length * 26 + 90)}
            />
          )}
          table={() => <DataTable rows={m.families} columns={famCols} rowKey={(f) => f.id} caption="Families" dense initialSort={{ key: "max", dir: "desc" }} />}
        />
      ) : null}

      {timeline.length ? (
        <Card>
          <CardHeader title="Run timeline" description="Per dataset step: how many entities were written, how long seeding took, and how long measuring every shape took." />
          <CardBody>
            <DataTable
              rows={timeline}
              rowKey={(r) => String(r.size)}
              caption="Run timeline"
              dense
              columns={[
                { key: "size", header: "Step", cell: (r) => <span className="num">{fmtNum(r.size)} entities</span> },
                { key: "items", header: "Written", align: "right", cell: (r) => (r.seed ? fmtNum(r.seed.items) : "—") },
                { key: "seed", header: "Seeding", align: "right", cell: (r) => (r.seed ? `${(r.seed.ms / 1000).toFixed(1)} s` : "—") },
                {
                  key: "rate",
                  header: "Write rate",
                  align: "right",
                  hideBelow: "sm",
                  cell: (r) => (r.seed && r.seed.ms > 0 ? `${fmtNum((r.seed.items / r.seed.ms) * 1000)} /s` : "—"),
                },
                { key: "measure", header: "Measuring", align: "right", cell: (r) => (r.measure ? `${(r.measure.ms / 1000).toFixed(1)} s` : "—") },
              ]}
            />
            {meta ? (
              <p className="mt-3 text-xs text-muted">
                {meta.runsPerShape} runs per shape ({meta.warmupRuns} warm-up discarded)
                {meta.seedParallel ? ` · ${meta.seedParallel} seeding batches in parallel` : ""} · chain {meta.chainId}
                {meta.startBlock != null ? ` · blocks ${fmtNum(meta.startBlock)} → ${fmtNum(meta.endBlock ?? meta.startBlock)}` : ""}
                {meta.client ? ` · ${meta.client}` : ""}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
