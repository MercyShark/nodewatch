import { useMemo, useState } from "react";
import type { BenchCatalog, BenchRun } from "@nodewatch/shared";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/form";
import { DataTable } from "@/components/ui/table";
import { ChartCard, type QueryState } from "@/charts/ChartCard";
import { DeltaBars } from "@/charts/DeltaBars";
import { useBenchRun } from "@/lib/queries";
import { fmtAgo, fmtNum } from "@/lib/format";
import { buildRun, compareRuns, ms, type RunModel } from "./model";
import { ShapeButton, Stat, TARGETS } from "./parts";

const label = (r: BenchRun) => `${r.id.slice(0, 8)} · ${TARGETS[r.target]?.label ?? r.target} · ${r.sizes.map((s) => fmtNum(s)).join("/")} · ${fmtAgo(r.startedAt)}`;

/** Two runs side by side: did a change (client upgrade, more data, faster seeding) move any shape? */
export function CompareTab({
  m,
  runs,
  catalog,
  safe,
  onOpen,
  state,
}: {
  m: RunModel;
  runs: BenchRun[];
  catalog: BenchCatalog | undefined;
  safe: boolean;
  onOpen: (id: string) => void;
  state: QueryState;
}) {
  const others = runs.filter((r) => r.id !== m.run.id && r.status === "done" && (r.target === "readonly") === (m.run.target === "readonly"));
  const [otherId, setOtherId] = useState<string | null>(null);
  const pick = otherId ?? others[0]?.id ?? null;
  const other = useBenchRun(pick);
  const om: RunModel | null = useMemo(() => (other.data ? buildRun(other.data, catalog, safe) : null), [other.data, catalog, safe]);
  const cmp = useMemo(() => (om ? compareRuns(m, om) : null), [m, om]);

  if (!others.length) return <EmptyState title="Nothing to compare yet">Finish a second run on the same kind of dataset to compare them.</EmptyState>;

  const rows = cmp?.rows ?? [];
  const slower = rows.filter((r) => r.pct > 10);
  const faster = rows.filter((r) => r.pct < -10);
  const med = rows.length ? [...rows].sort((a, b) => a.pct - b.pct)[Math.floor(rows.length / 2)]!.pct : 0;
  const sorted = [...rows].sort((a, b) => b.pct - a.pct);
  const height = Math.max(260, rows.length * 22 + 80);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Compare two runs" description={`This run: ${label(m.run)}`} />
        <CardBody>
          <Field label="Compare with" htmlFor="cmp-run">
            <Select id="cmp-run" value={pick ?? ""} onChange={(e) => setOtherId(e.target.value)}>
              {others.map((r) => (
                <option key={r.id} value={r.id}>
                  {label(r)}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {other.isLoading ? (
        <Skeleton className="h-72" />
      ) : other.error ? (
        <ErrorState error={other.error} onRetry={() => void other.refetch()} />
      ) : !cmp?.size ? (
        <EmptyState title="No common dataset size">The two runs measured different sizes, so there is nothing to compare one-to-one.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Compared at" value={fmtNum(cmp.size)} sub={`entities · ${rows.length} shapes in both runs`} />
            <Stat label="Median change" value={`${med > 0 ? "+" : ""}${med.toFixed(1)} %`} sub="p95, this run vs the other" />
            <Stat label="Slower > 10 %" value={fmtNum(slower.length)} tone={slower.length ? "warn" : "ok"} toneText="regressions" sub="shapes" />
            <Stat label="Faster > 10 %" value={fmtNum(faster.length)} sub="shapes" />
          </div>
          <ChartCard
            title={`p95 change at ${fmtNum(cmp.size)} entities`}
            description="Positive = slower in this run. Changes within ±10 % are usually noise between runs."
            state={state}
            height={height}
            chart={() => (
              <DeltaBars
                items={sorted.map((r) => ({ key: r.view.id, label: r.view.name, pct: r.pct, detail: `${ms(r.b)} → ${ms(r.a)} ms` }))}
                height={height}
              />
            )}
            table={() => (
              <DataTable
                rows={rows}
                rowKey={(r) => r.view.id}
                caption="Run comparison"
                dense
                initialSort={{ key: "pct", dir: "desc" }}
                maxHeight={height}
                columns={[
                  { key: "shape", header: "Shape", cell: (r) => <ShapeButton name={r.view.name} onOpen={() => onOpen(r.view.id)} slow={r.view.slow} />, sort: (r) => r.view.num },
                  { key: "b", header: "Other ms", align: "right", cell: (r) => ms(r.b), sort: (r) => r.b },
                  { key: "a", header: "This ms", align: "right", cell: (r) => ms(r.a), sort: (r) => r.a },
                  { key: "d", header: "Δ ms", align: "right", cell: (r) => `${r.deltaMs >= 0 ? "+" : "−"}${ms(Math.abs(r.deltaMs))}`, sort: (r) => r.deltaMs },
                  { key: "pct", header: "Δ %", align: "right", cell: (r) => `${r.pct > 0 ? "+" : ""}${r.pct.toFixed(1)} %`, sort: (r) => r.pct },
                ]}
              />
            )}
          />
        </>
      )}
    </div>
  );
}
