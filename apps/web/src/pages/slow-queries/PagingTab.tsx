import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/form";
import { DataTable } from "@/components/ui/table";
import { ChartCard, type QueryState } from "@/charts/ChartCard";
import { LogLogChart } from "@/charts/LogLogChart";
import { SERIES_COLORS, SERIES_DASH } from "@/charts/theme";
import { fmtNum } from "@/lib/format";
import { ms, type RunModel, type ShapeView } from "./model";
import { ShapeButton } from "./parts";

/** OFFSET vs key-cursor paging at 0 / 25 / 50 / 90 % depth. Offset walks every skipped row; a cursor jumps. */
export function PagingTab({ m, safe, onOpen, state }: { m: RunModel; safe: boolean; onOpen: (id: string) => void; state: QueryState }) {
  const [size, setSize] = useState(m.largest);
  const paging = m.shapes.filter((s) => s.info?.paging);
  if (!paging.length) return <EmptyState title="No paging shapes in this run">Paging shapes run on every target.</EmptyState>;

  const methods = (["offset", "cursor"] as const).map((method) => ({
    method,
    shapes: paging.filter((s) => s.info!.paging!.method === method).sort((a, b) => a.info!.paging!.depthPct - b.info!.paging!.depthPct),
  }));
  const at = (s: ShapeView, z: number) => s.results.find((r) => r.size === z)?.p95Ms ?? null;
  const depths = [...new Set(paging.map((s) => s.info!.paging!.depthPct))].sort((a, b) => a - b);
  const label = (method: "offset" | "cursor") => (safe ? `method ${method === "offset" ? "A" : "B"}` : method === "offset" ? "OFFSET" : "key cursor");

  const series = methods.map((mm, i) => ({
    key: mm.method,
    label: label(mm.method),
    color: SERIES_COLORS[i === 0 ? 3 : 0],
    dash: SERIES_DASH[i === 0 ? 1 : 0],
    points: mm.shapes.map((s) => ({ x: s.info!.paging!.depthPct, y: at(s, size) ?? 0 })).filter((p) => p.y > 0),
  }));
  const rows = depths.map((d) => {
    const o = methods[0]!.shapes.find((s) => s.info!.paging!.depthPct === d);
    const c = methods[1]!.shapes.find((s) => s.info!.paging!.depthPct === d);
    const ov = o ? at(o, size) : null;
    const cv = c ? at(c, size) : null;
    return { d, o, c, ov, cv, ratio: ov && cv ? ov / cv : null };
  });
  const deep = rows[rows.length - 1];
  const first = rows[0];
  const offsetGrowth = deep?.ov && first?.ov ? deep.ov / first.ov : null;
  const cursorGrowth = deep?.cv && first?.cv ? deep.cv / first.cv : null;

  // Depth cost across sizes: the deepest offset page at each size.
  const deepOffset = methods[0]!.shapes[methods[0]!.shapes.length - 1];
  const deepCursor = methods[1]!.shapes[methods[1]!.shapes.length - 1];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Dataset size" htmlFor="paging-size">
          <Select id="paging-size" value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {m.sizes.map((z) => (
              <option key={z} value={z}>
                {fmtNum(z)} entities
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Card>
        <CardHeader title="Reading" description={`At ${fmtNum(size)} entities.`} />
        <CardBody className="text-sm text-fg">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-muted">
            {offsetGrowth != null ? (
              <li>
                {label("offset")}: the page at <span className="num">{deep!.d} %</span> depth costs <span className="num">{offsetGrowth.toFixed(2)}×</span> the first page (
                <span className="num">{ms(first!.ov!)}</span> → <span className="num">{ms(deep!.ov!)} ms</span>).
              </li>
            ) : null}
            {cursorGrowth != null ? (
              <li>
                {label("cursor")}: <span className="num">{cursorGrowth.toFixed(2)}×</span> (<span className="num">{ms(first!.cv!)}</span> →{" "}
                <span className="num">{ms(deep!.cv!)} ms</span>).
              </li>
            ) : null}
            {deep?.ratio != null ? (
              <li>
                At the deepest page {label("offset")} takes <span className="num">{deep.ratio.toFixed(2)}×</span> as long as {label("cursor")}
                {deep.ratio > 1.2 ? `: for deep pages, prefer the ${label("cursor")}.` : deep.ratio < 0.83 ? "." : ": about the same at this size."}
              </li>
            ) : null}
          </ul>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Page cost by depth"
          description="p95 for one page at increasing depth."
          state={state}
          height={340}
          chart={() => (
            <LogLogChart
              series={series}
              xTicks={depths}
              xLog={false}
              xFormat={(v) => `${v} %`}
              titleFormat={(v) => `page at ${v} % depth`}
              height={340}
              xUnit="depth into the results"
              yUnit="p95 ms"
              yFormat={ms}
            />
          )}
          table={() => (
            <DataTable
              rows={rows}
              rowKey={(r) => String(r.d)}
              caption="Paging cost by depth"
              dense
              columns={[
                { key: "d", header: "Depth", cell: (r) => <span className="num">{r.d} %</span> },
                { key: "o", header: `${label("offset")} ms`, align: "right", cell: (r) => (r.ov == null ? "—" : ms(r.ov)) },
                { key: "c", header: `${label("cursor")} ms`, align: "right", cell: (r) => (r.cv == null ? "—" : ms(r.cv)) },
                { key: "r", header: "ratio", align: "right", cell: (r) => (r.ratio == null ? "—" : `${r.ratio.toFixed(2)}×`) },
              ]}
            />
          )}
        />
        <ChartCard
          title="Deepest page as the data grows"
          description="Deepest page p95 per method (log-log)."
          state={state}
          isEmpty={m.sizes.length < 2 || !deepOffset || !deepCursor}
          emptyText="Needs two or more dataset sizes."
          height={340}
          chart={() => (
            <LogLogChart
              series={[deepOffset!, deepCursor!].map((s, i) => ({
                key: s.id,
                label: `${label(i === 0 ? "offset" : "cursor")} at ${s.info!.paging!.depthPct} % · k ${s.k?.toFixed(2) ?? "—"}`,
                color: SERIES_COLORS[i === 0 ? 3 : 0],
                dash: SERIES_DASH[i === 0 ? 1 : 0],
                points: s.results.map((r) => ({ x: r.size, y: r.p95Ms })),
              }))}
              xTicks={m.sizes}
              height={340}
              xUnit="dataset size, entities"
              yUnit="p95 ms"
              yFormat={ms}
            />
          )}
        />
      </div>

      <Card>
        <CardHeader title="Paging shapes" />
        <CardBody>
          <DataTable
            rows={paging}
            rowKey={(s) => s.id}
            caption="Paging shapes"
            dense
            columns={[
              { key: "shape", header: "Shape", cell: (s) => <ShapeButton name={s.name} onOpen={() => onOpen(s.id)} slow={s.slow} />, sort: (s) => s.num },
              { key: "m", header: "Method", cell: (s) => label(s.info!.paging!.method), sort: (s) => s.info!.paging!.method },
              { key: "d", header: "Depth", align: "right", cell: (s) => `${s.info!.paging!.depthPct} %`, sort: (s) => s.info!.paging!.depthPct },
              { key: "p", header: `p95 @ ${fmtNum(size)}`, align: "right", cell: (s) => (at(s, size) == null ? "—" : ms(at(s, size)!)), sort: (s) => at(s, size) },
              { key: "k", header: "k", align: "right", cell: (s) => (s.k == null ? "—" : s.k.toFixed(2)), sort: (s) => s.k },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
