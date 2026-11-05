import { Database, FlaskConical, Lock, Ruler, ShieldCheck, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import type { BenchCatalog } from "@nodewatch/shared";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="num inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs text-fg">{n}</span>
      <div className="min-w-0">
        <p className="font-medium text-fg">{title}</p>
        <div className="text-muted">{children}</div>
      </div>
    </li>
  );
}

export function MethodTab({ catalog }: { catalog: BenchCatalog | undefined }) {
  const t = catalog?.thresholds ?? { slowP95Ms: 250, slowK: 1.2 };
  const mth = catalog?.method ?? { runsPerShape: 30, warmupRuns: 5, seedParallel: 8 };
  const timed = mth.runsPerShape - mth.warmupRuns;
  const nSynth = catalog?.shapes.filter((s) => s.dataset === "synthetic").length ?? 29;
  const nMarket = catalog?.shapes.filter((s) => s.dataset === "marketplace").length ?? 13;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="xl:col-span-2">
        <CardHeader title="How a run works" icon={<FlaskConical />} />
        <CardBody>
          <ol className="flex flex-col gap-4 text-sm">
            <Step n={1} title="Target">
              Own node writes <span className="num text-fg">nwbench.item</span> ({nSynth} shapes) to Rabdi, paid by the bench writer. Private node uses the same
              dataset on a throwaway local chain, free. Live market reads existing marketplace entities ({nMarket} shapes) and writes nothing.
            </Step>
            <Step n={2} title="Seed">
              Batches of 25, up to {mth.seedParallel} in flight. Timing starts once every item is queryable.
            </Step>
            <Step n={3} title="Time">
              {mth.runsPerShape} runs per shape, first {mth.warmupRuns} discarded, {timed} kept: percentiles, σ, rows, bytes, errors.
            </Step>
            <Step n={4} title="Grow">Add entities (e.g. 500 → 5,000) and time again at each size.</Step>
            <Step n={5} title="Flag">
              Fit <span className="num text-fg">p95 = a · size^k</span>. Slow if p95 &gt; {t.slowP95Ms} ms at the largest size or k &gt; {t.slowK}.
            </Step>
            <Step n={6} title="Clean up">
              Test entities expire in 6 h; the private node is removed after the run. Findings stay admin-only until sent to Arkiv through the encrypted vault.
            </Step>
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Reading the numbers" icon={<Ruler />} />
        <CardBody>
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="font-medium text-fg">p50 / p95 / p99</dt>
              <dd className="text-muted">Share of timed runs faster than this. p95 is the headline number.</dd>
            </div>
            <div>
              <dt className="font-medium text-fg">σ, min, max</dt>
              <dd className="text-muted">Jitter. Large σ with a small p50 means occasional stalls.</dd>
            </div>
            <div>
              <dt className="font-medium text-fg">Rows</dt>
              <dd className="text-muted">Results returned. Every shape is built to match data.</dd>
            </div>
            <div>
              <dt className="font-medium text-fg">Risk</dt>
              <dd className="text-muted">
                max(p95 ÷ {t.slowP95Ms} ms, k ÷ {t.slowK}). 100 % is the slow line.
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Growth factor k" icon={<TrendingUp />} />
        <CardBody className="flex flex-col gap-3 text-sm">
          <p className="text-muted">10× the data multiplies p95 by 10^k.</p>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">What k means</caption>
            <thead>
              <tr className="border-b border-border text-xs tracking-wide text-muted uppercase">
                <th scope="col" className="py-1.5 text-left font-medium">k</th>
                <th scope="col" className="py-1.5 text-left font-medium">10× data →</th>
                <th scope="col" className="py-1.5 text-left font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              {[
                ["≈ 0", "same time", "index lookup"],
                ["0.5", "3.2× time", "sub-linear"],
                ["1", "10× time", "linear scan"],
                [`> ${t.slowK}`, `> ${(10 ** t.slowK).toFixed(0)}× time`, "super-linear, flagged"],
              ].map(([k, x, m]) => (
                <tr key={k} className="border-b border-border/50 last:border-0">
                  <td className="num py-1.5 text-fg">{k}</td>
                  <td className="num py-1.5">{x}</td>
                  <td className="py-1.5">{m}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted">r² is fit quality (0–1). Projections past the largest size are hints, not measurements.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Safety" icon={<ShieldCheck />} />
        <CardBody>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted marker:text-muted">
            <li>Queries go only to this node's RPC or the private node on loopback.</li>
            <li>Own node: separate bench key with at least 0.05 tGLM, at most 5,000 entities.</li>
            <li>Private node: 3 vCPU / 6 GiB, only while a run lasts.</li>
            <li>Pauses if head lag grows or host CPU passes 85 %; aborts after 15 min unhealthy.</li>
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Privacy" icon={<Lock />} />
        <CardBody>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted marker:text-muted">
            <li>Admin-only. Query text is encrypted at rest.</li>
            <li>Demo-safe view shows shape #N only.</li>
            <li>Findings are never published; they go to Arkiv through the encrypted vault.</li>
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Datasets" icon={<Database />} />
        <CardBody>
          <ul className="flex flex-col gap-2 text-sm">
            {(catalog?.datasets ?? []).map((d) => (
              <li key={d.id}>
                <p className="font-medium text-fg">
                  {d.title} <span className="num font-normal text-muted">· {d.schema}</span>
                </p>
                <p className="text-muted">{d.sizing}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
