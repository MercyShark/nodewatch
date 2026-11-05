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

/** How the finder works, in plain words: for operators, judges, and anyone reading the numbers. */
export function MethodTab({ catalog }: { catalog: BenchCatalog | undefined }) {
  const t = catalog?.thresholds ?? { slowP95Ms: 250, slowK: 1.2 };
  const mth = catalog?.method ?? { runsPerShape: 30, warmupRuns: 5, seedParallel: 8 };
  const timed = mth.runsPerShape - mth.warmupRuns;
  const nSynth = catalog?.shapes.filter((s) => s.dataset === "synthetic").length ?? 29;
  const nMarket = catalog?.shapes.filter((s) => s.dataset === "marketplace").length ?? 13;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="xl:col-span-2">
        <CardHeader title="How a run works" icon={<FlaskConical />} description="The same steps for every target." />
        <CardBody>
          <ol className="flex flex-col gap-4 text-sm">
            <Step n={1} title="Pick a target and dataset">
              Own node seeds the <span className="num text-fg">nwbench.item</span> dataset on Rabdi through this node ({nSynth} shapes), paid by a dedicated
              bench writer. Live market reads the existing marketplace entities ({nMarket} shapes) and writes nothing.
            </Step>
            <Step n={2} title="Seed the first size">
              Entities are written in batches of 25, up to {mth.seedParallel} batches in flight from one key with consecutive nonces. Measuring starts only when every
              item is queryable, so no shape is timed on a partial dataset.
            </Step>
            <Step n={3} title="Time every shape">
              Each shape runs {mth.runsPerShape} times; the first {mth.warmupRuns} are thrown away (cold caches), the other {timed} are kept. From them: p50, p95, p99, min,
              max, mean and σ, plus rows returned, response bytes and errors.
            </Step>
            <Step n={4} title="Grow the dataset and repeat">
              More entities are added (e.g. 500 → 1,000 → 2,500 → 5,000) and step 3 runs again at each size.
            </Step>
            <Step n={5} title="Fit and flag">
              For each shape, fit <span className="num text-fg">p95 = a · size^k</span> (a straight line on log-log axes). Slow if p95 &gt; {t.slowP95Ms} ms at the largest size
              or k &gt; {t.slowK}.
            </Step>
            <Step n={6} title="Clean up and report">
              Test entities expire on their own after 6 hours. Findings stay in this admin view and in a private findings file; “Send to Arkiv” encrypts them to the Arkiv engineer's key and
              uploads them through the Swarm vault.
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
              <dd className="text-muted">
                Half / 95 % / 99 % of the timed runs were faster than this. p95 is the main number: the slow-but-normal case a user actually notices.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-fg">σ, min, max</dt>
              <dd className="text-muted">How much the runs of one shape jitter. A large σ next to a small p50 means occasional stalls, not a slow query.</dd>
            </div>
            <div>
              <dt className="font-medium text-fg">Rows</dt>
              <dd className="text-muted">How many results came back. A shape that returns 0 rows is timing an empty answer, so every shape is designed to match data.</dd>
            </div>
            <div>
              <dt className="font-medium text-fg">Risk</dt>
              <dd className="text-muted">
                The larger of p95 ÷ {t.slowP95Ms} ms and k ÷ {t.slowK}. 100 % means the shape is at the slow line on one of the two measures.
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="The growth factor k" icon={<TrendingUp />} />
        <CardBody className="flex flex-col gap-3 text-sm">
          <p className="text-muted">How fast a shape gets worse as the data grows. With 10× the data, p95 grows by 10^k.</p>
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
                ["≈ 0", "same time", "flat: an index lookup, size does not matter"],
                ["0.5", "3.2× time", "sub-linear: grows slower than the data"],
                ["1", "10× time", "linear: time follows the data (a scan)"],
                [`> ${t.slowK}`, `> ${(10 ** t.slowK).toFixed(0)}× time`, "super-linear: flagged slow, will fall over at scale"],
              ].map(([k, x, m]) => (
                <tr key={k} className="border-b border-border/50 last:border-0">
                  <td className="num py-1.5 text-fg">{k}</td>
                  <td className="num py-1.5">{x}</td>
                  <td className="py-1.5">{m}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted">
            r² (0–1) says how well the line fits the points. Projections beyond the largest measured size are hints for which larger run to try, never measurements.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Safety" icon={<ShieldCheck />} />
        <CardBody>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted marker:text-muted">
            <li>The server refuses any query target except this node's RPC.</li>
            <li>An own-node run refuses to start until the bench writer holds at least 0.05 tGLM, and is limited to 5,000 entities.</li>
            <li>A run pauses itself if the node's head lag grows or host CPU passes 85 %, and aborts after 15 minutes unhealthy.</li>
            <li>Own-node runs need their own key: never the provider key, never the heartbeat key, at most 5,000 entities.</li>
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Privacy" icon={<Lock />} />
        <CardBody>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted marker:text-muted">
            <li>This page is admin-only. Query text is encrypted at rest in the database.</li>
            <li>The demo-safe view shows only shape #N, for screen recordings and presentations.</li>
            <li>Findings are never committed and never published: they go to Arkiv engineers through the encrypted Swarm vault.</li>
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
          <p className="mt-3 text-xs text-muted">Full attribute tables are on the Coverage tab.</p>
        </CardBody>
      </Card>
    </div>
  );
}
