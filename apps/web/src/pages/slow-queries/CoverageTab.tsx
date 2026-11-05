import { Fragment, useMemo } from "react";
import { Check, Database, Minus } from "lucide-react";
import type { BenchCatalog, BenchDatasetInfo, BenchRun, BenchShapeInfo } from "@nodewatch/shared";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/status";
import { Skeleton } from "@/components/ui/feedback";
import { fmtAgo, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { coverage, displayName, ms, numbering, type CoverageCell } from "./model";
import { ShapeButton, TARGETS } from "./parts";

/** Sequential single-hue tint by log(p95): the number is always printed, the tint only helps scanning. */
function tint(p95: number, lo: number, hi: number): string {
  const t = hi > lo ? (Math.log10(Math.max(p95, 0.1)) - lo) / (hi - lo) : 0;
  const a = 0.06 + Math.max(0, Math.min(1, t)) * 0.38;
  return `rgba(59,130,246,${a.toFixed(3)})`;
}

function DatasetCard({ d, shapes }: { d: BenchDatasetInfo; shapes: number }) {
  return (
    <Card className="h-full">
      <CardHeader
        title={d.title}
        icon={<Database />}
        description={
          <>
            <span className="num text-fg">{d.schema}</span> · <span className="num">{shapes}</span> shapes
          </>
        }
        actions={
          <div className="flex flex-wrap gap-1">
            {d.targets.map((t) => (
              <Badge key={t}>{TARGETS[t]?.label ?? t}</Badge>
            ))}
          </div>
        }
      />
      <CardBody className="flex flex-col gap-3 text-sm">
        <p className="text-fg">{d.description}</p>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Size</dt>
          <dd>{d.sizing}</dd>
          <dt className="text-muted">Writes</dt>
          <dd>{d.writes}</dd>
        </dl>
        <div className="scrollbar-thin max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{d.title}: attributes</caption>
            <thead>
              <tr className="border-b border-border text-xs tracking-wide text-muted uppercase">
                <th scope="col" className="px-2 py-1.5 text-left font-medium">Attribute</th>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">Type</th>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">Indexed</th>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">Values</th>
              </tr>
            </thead>
            <tbody>
              {d.attributes.map((a) => (
                <tr key={a.name} className="border-b border-border/50 last:border-0">
                  <td className="num px-2 py-1.5 whitespace-nowrap text-fg">{a.name}</td>
                  <td className="num px-2 py-1.5 whitespace-nowrap text-muted">{a.type}</td>
                  <td className="px-2 py-1.5">
                    {a.indexed ? (
                      <span className="inline-flex items-center gap-1 text-ok">
                        <Check className="size-3.5" aria-hidden /> yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted">
                        <Minus className="size-3.5" aria-hidden /> stored only
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-muted">{a.values}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function Cell({ cell, lo, hi, applicable }: { cell: CoverageCell | undefined; lo: number; hi: number; applicable: boolean }) {
  if (!applicable)
    return (
      <td className="px-2 py-1 text-center text-xs text-muted/60">
        <span aria-hidden>—</span>
        <span className="sr-only">not part of this dataset</span>
      </td>
    );
  if (!cell)
    return (
      <td className="px-2 py-1 text-center text-xs text-muted">
        <span aria-hidden>○</span>
        <span className="sr-only">available, not measured yet</span>
      </td>
    );
  return (
    <td className="px-1 py-1 text-right">
      <span
        title={`p95 ${ms(cell.p95)} ms · run ${cell.runId.slice(0, 8)} · ${fmtAgo(cell.startedAt)}`}
        className={cn("num inline-flex min-w-16 items-center justify-end gap-1 rounded px-2 py-1 text-xs text-fg", cell.slow && "ring-1 ring-warn")}
        style={{ background: tint(cell.p95, lo, hi) }}
      >
        {cell.slow ? (
          <span className="text-warn" aria-hidden>
            ▲
          </span>
        ) : null}
        {ms(cell.p95)}
        {cell.slow ? <span className="sr-only"> slow</span> : null}
      </span>
    </td>
  );
}

export function CoverageTab({
  catalog,
  runs,
  safe,
  onOpen,
}: {
  catalog: BenchCatalog | undefined;
  runs: BenchRun[];
  safe: boolean;
  onOpen: (id: string) => void;
}) {
  const cov = useMemo(() => coverage(runs), [runs]);
  const num = useMemo(() => numbering(catalog), [catalog]);
  const values = [...cov.cells.values(), ...cov.marketplace.values()].map((c) => c.p95);
  const lo = Math.log10(Math.max(0.1, values.length ? Math.min(...values) : 1));
  const hi = Math.log10(values.length ? Math.max(...values) : 10);

  if (!catalog)
    return (
      <div role="status" aria-label="Loading the shape catalog" className="flex flex-col gap-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );

  const famLabel = new Map(catalog.families.map((f) => [f.id, f.label]));
  const famDesc = new Map(catalog.families.map((f) => [f.id, f.description]));
  // Group rows by family (private view) or just list them in catalog order (demo-safe).
  const groups: { key: string; title: string; note?: string; shapes: BenchShapeInfo[] }[] = safe
    ? [
        { key: "synthetic", title: "Synthetic dataset shapes", shapes: catalog.shapes.filter((s) => s.dataset === "synthetic") },
        { key: "marketplace", title: "Marketplace dataset shapes", shapes: catalog.shapes.filter((s) => s.dataset === "marketplace") },
      ]
    : catalog.families
        .map((f) => ({ key: f.id, title: famLabel.get(f.id) ?? f.id, note: famDesc.get(f.id), shapes: catalog.shapes.filter((s) => s.family === f.id) }))
        .filter((g) => g.shapes.length);

  const synth = catalog.shapes.filter((s) => s.dataset === "synthetic");
  const market = catalog.shapes.filter((s) => s.dataset === "marketplace");
  const synthMeasured = synth.filter((s) => cov.synthSizes.some((z) => cov.cells.has(`${s.id}|${z}`))).length;
  const marketMeasured = market.filter((s) => cov.marketplace.has(s.id)).length;
  const sizeCols = cov.synthSizes.length ? cov.synthSizes : [];
  const colCount = 2 + sizeCols.length + 2;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {catalog.datasets.map((d) => (
          <DatasetCard key={d.id} d={d} shapes={catalog.shapes.filter((s) => s.dataset === d.id).length} />
        ))}
      </div>

      <Card>
        <CardHeader
          title="Shapes × datasets"
          description={
            <>
              Every shape the finder knows, which dataset it runs on, and its latest p95 (ms) at each dataset size, across all{" "}
              <span className="num">{cov.doneRuns}</span> finished runs. Synthetic: <span className="num">{synthMeasured}</span>/<span className="num">{synth.length}</span>{" "}
              measured. Marketplace: <span className="num">{marketMeasured}</span>/<span className="num">{market.length}</span> measured
              {marketMeasured === 0 ? " (start a read-only run to fill this column)" : ""}.
            </>
          }
        />
        <CardBody className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
            <li className="flex items-center gap-1.5">
              <span className="num rounded px-1.5 py-0.5 text-fg" style={{ background: tint(10 ** hi, lo, hi) }}>
                12.3
              </span>
              p95 in ms, darker = slower
            </li>
            <li className="flex items-center gap-1.5">
              <span className="num rounded px-1.5 py-0.5 text-fg ring-1 ring-warn">▲ 300</span> slow
            </li>
            <li>○ available, not measured yet</li>
            <li>— not part of that dataset</li>
          </ul>
          <div className="scrollbar-thin relative max-h-[720px] max-w-full overflow-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Shapes by dataset and size, latest p95 in milliseconds</caption>
              <thead className="sticky top-0 z-[2] bg-surface">
                <tr className="border-b border-border text-xs tracking-wide text-muted uppercase">
                  <th scope="col" rowSpan={2} className="sticky left-0 z-[3] bg-surface px-3 py-2 text-left font-medium">
                    Shape
                  </th>
                  <th scope="col" rowSpan={2} className="hidden px-3 py-2 text-left font-medium lg:table-cell">
                    {safe ? "Dataset" : "What it asks"}
                  </th>
                  <th scope="colgroup" colSpan={Math.max(1, sizeCols.length)} className="border-l border-border px-2 pt-2 text-center font-medium">
                    Synthetic · nwbench.item
                  </th>
                  <th scope="col" rowSpan={2} className="border-l border-border px-2 py-2 text-center font-medium">
                    Marketplace
                    <span className="block normal-case">read-only{cov.marketSizes.length ? ` · ${cov.marketSizes.map((s) => fmtNum(s)).join("/")}` : ""}</span>
                  </th>
                  <th scope="col" rowSpan={2} className="px-2 py-2 text-right font-medium">
                    Runs
                  </th>
                </tr>
                <tr className="border-b border-border text-xs text-muted">
                  {sizeCols.length ? (
                    sizeCols.map((z, i) => (
                      <th key={z} scope="col" className={cn("num px-2 pb-2 text-right font-medium", i === 0 && "border-l border-border")}>
                        {fmtNum(z)}
                      </th>
                    ))
                  ) : (
                    <th scope="col" className="border-l border-border px-2 pb-2 text-center font-medium normal-case">
                      no runs yet
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="bg-surface-2/60">
                      <th scope="colgroup" colSpan={colCount} className="px-3 py-1.5 text-left text-xs font-medium text-fg">
                        {g.title}
                        {g.note ? <span className="ml-2 font-normal text-muted">{g.note}</span> : null}
                      </th>
                    </tr>
                    {g.shapes.map((s) => {
                      const n = num(s.id);
                      const name = displayName(n, s, safe);
                      const measured = s.dataset === "synthetic" ? sizeCols.some((z) => cov.cells.has(`${s.id}|${z}`)) : cov.marketplace.has(s.id);
                      return (
                        <tr key={s.id} className="border-b border-border/50 hover:bg-surface-2/40">
                          <th scope="row" className="sticky left-0 z-[1] bg-surface px-2 py-1 text-left font-normal">
                            {measured ? <ShapeButton name={name} onOpen={() => onOpen(s.id)} /> : <span className="num px-1 text-sm text-muted">{name}</span>}
                          </th>
                          <td className="hidden max-w-[22rem] px-3 py-1 text-xs text-muted lg:table-cell">
                            {safe ? (s.dataset === "synthetic" ? "synthetic" : "marketplace") : s.summary}
                          </td>
                          {sizeCols.length ? (
                            sizeCols.map((z) => (
                              <Cell key={z} cell={cov.cells.get(`${s.id}|${z}`)} lo={lo} hi={hi} applicable={s.dataset === "synthetic"} />
                            ))
                          ) : (
                            <Cell cell={undefined} lo={lo} hi={hi} applicable={s.dataset === "synthetic"} />
                          )}
                          <Cell cell={cov.marketplace.get(s.id)} lo={lo} hi={hi} applicable={s.dataset === "marketplace"} />
                          <td className="num px-2 py-1 text-right text-xs text-muted">{cov.runsPerShape.get(s.id) ?? 0}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
