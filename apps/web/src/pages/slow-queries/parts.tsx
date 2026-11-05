import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EyeOff, Play, ShieldCheck, Timer } from "lucide-react";
import type { BenchRun } from "@nodewatch/shared";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { InlineError } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge, ToneIcon, type Tone } from "@/components/ui/status";
import { useBenchWriter, useStartBench } from "@/lib/queries";
import { Hex } from "@/components/ui/copy";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { pushToast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { ACTIVE } from "./model";

/** `privateOnly`: above 5,000 entities, so only on the private node (on Rabdi every entity is a paid transaction). */
export const PRESETS = {
  quick: { label: "Quick: 500 → 1,000", sizes: [500, 1000], privateOnly: false },
  standard: { label: "Standard: 500 → 5,000", sizes: [500, 1000, 2500, 5000], privateOnly: false },
  large: { label: "Large: 5,000 → 50,000", sizes: [5000, 10000, 25000, 50000], privateOnly: true },
  wide: { label: "Wide: 500 → 50,000", sizes: [500, 2500, 10000, 50000], privateOnly: true },
} as const;
type PresetKey = keyof typeof PRESETS;

export const TARGETS: Record<BenchRun["target"], { label: string; help: string; confirm: string }> = {
  "own-node": {
    label: "Own node",
    help: "Measures this node on real Rabdi state. Seeds nwbench.item test entities through this node (paid in tGLM by the bench writer, 6 h expiry), then times every shape at each size. Max 5,000 entities. The run pauses itself if the node lags or the host gets busy.",
    confirm: "This writes real nwbench.item transactions to Rabdi with the bench writer key, paid in tGLM, with a 6 h expiry.",
  },
  readonly: {
    label: "Live market (read-only)",
    help: "No writes at all. Times queries over the live marketplace entities (LB listing, offers, agreements, counters) on this node. One dataset size, so it is a latency snapshot, not a scaling fit.",
    confirm: "This only reads the live marketplace entities from this node. No entities are written and no gas is spent.",
  },
  sandbox: {
    label: "Private node",
    help: "Free, and nothing leaves this machine. Starts a private Arkiv node on this host for the run (3 vCPU / 6 GiB, free dev gas), loads test entities into it, measures, then removes it. Up to 50,000 entities. It runs the Arkiv dev build, not your Rabdi node.",
    confirm: "This starts a private Arkiv node on this host (3 vCPU / 6 GiB), loads test entities into it with free dev gas, and removes it when the run ends. Nothing is written to Rabdi.",
  },
};
const OFFERED: BenchRun["target"][] = ["own-node", "sandbox", "readonly"];

export const statusTone: Record<BenchRun["status"], Tone> = {
  queued: "info",
  seeding: "info",
  running: "info",
  paused: "warn",
  done: "ok",
  failed: "crit",
};

/** A number with a label: the KPI row on the summary. */
export function Stat({
  label,
  value,
  sub,
  tone,
  toneText,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  toneText?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "h-full rounded-xl border bg-surface p-4",
        tone === "crit" ? "border-crit/50" : tone === "warn" ? "border-warn/45" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted uppercase">
          {icon ? (
            <span className="[&>svg]:size-3.5" aria-hidden>
              {icon}
            </span>
          ) : null}
          {label}
        </p>
        {tone && tone !== "ok" && tone !== "neutral" && toneText ? (
          <span className="flex items-center gap-1 text-xs text-fg">
            <ToneIcon tone={tone} className="size-3.5" />
            {toneText}
          </span>
        ) : null}
      </div>
      <p className="num mt-2 text-2xl font-semibold text-fg">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

/** Tab bar (roving focus with the arrow keys). Scrolls sideways inside itself on phones. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabDef<T>[]; value: T; onChange: (t: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const n = (i + dir + tabs.length) % tabs.length;
    onChange(tabs[n]!.id);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
      {tabs.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls={`panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors duration-150",
              active ? "border-primary font-medium text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            <span className="[&>svg]:size-4" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Demo-safe switch: query text, names and families are findings, so screen recordings show shape #N only. */
export function PrivacyBar({ admin, safe, onSafe }: { admin: boolean; safe: boolean; onSafe: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2">
        {safe ? <EyeOff className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /> : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />}
        <span>
          {safe ? (
            <>
              <span className="font-medium text-fg">Demo-safe view.</span> Only <span className="num text-fg">shape #N</span> is shown: no query text, names,
              families or descriptions. Safe to record or present.
            </>
          ) : (
            <>
              <span className="font-medium text-fg">Private view.</span> Query text, names and families are findings: they stay in this admin view and go
              to Arkiv engineers only through the encrypted Swarm vault. Switch to demo-safe before recording.
            </>
          )}
        </span>
      </p>
      {admin ? (
        <Segmented
          size="sm"
          label="Detail level"
          value={safe ? "safe" : "private"}
          onChange={(v) => onSafe(v === "safe")}
          options={[
            { value: "private", label: "Private detail" },
            { value: "safe", label: "Demo-safe" },
          ]}
        />
      ) : null}
    </div>
  );
}

export function RunControls({ running, onStarted }: { running: boolean; onStarted: (id: string) => void }) {
  const [target, setTarget] = useState<BenchRun["target"]>("own-node");
  const writer = useBenchWriter(true);
  const w = writer.data;
  const glm = (wei: string | null | undefined) => (wei == null ? null : Number(BigInt(wei)) / 1e18);
  const unfunded = target === "own-node" && !!w?.problem;
  const [preset, setPreset] = useState<PresetKey>("standard");
  const [confirm, setConfirm] = useState(false);
  const start = useStartBench();
  // Presets above 5,000 exist only for the private node; switching back falls back to Standard.
  const presetKey: PresetKey = PRESETS[preset].privateOnly && target !== "sandbox" ? "standard" : preset;
  const sizes = PRESETS[presetKey].sizes;

  return (
    <Card className="h-full">
      <CardHeader
        title="Run a benchmark"
        icon={<Timer />}
        description="Queries go only to this node's EL_RPC_URL or the private node on this host. Any other target is refused by the server."
      />
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Target</span>
          <Segmented
            label="Benchmark target"
            value={target}
            onChange={setTarget}
            options={OFFERED.map((value) => ({ value, label: TARGETS[value].label }))}
          />
          <p className="text-xs text-muted">{TARGETS[target].help}</p>
        </div>
        {target === "own-node" ? (
          <div className={cn("rounded-lg border px-3 py-2 text-sm", unfunded ? "border-warn/45 bg-warn/5" : "border-border bg-surface-2/50")}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className="text-muted">Bench writer</span>
              {w?.address ? <Hex value={w.address} /> : <span className="text-muted">{writer.isLoading ? "loading…" : "not configured"}</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className="text-muted">Balance</span>
              <span className="num text-fg">{glm(w?.balanceWei) == null ? "—" : `${glm(w?.balanceWei)!.toFixed(4)} tGLM`}</span>
            </div>
            {unfunded ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-fg">
                <ToneIcon tone="warn" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {w!.address
                    ? `Fund this address with at least ${glm(w!.minWei)} tGLM from the faucet (1–2 tGLM covers many runs). The balance refreshes every 30 s.`
                    : w!.problem}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
        {target === "readonly" ? null : (
          <Field label="Dataset sizes" htmlFor="bench-sizes" hint={`Entities per step: ${sizes.map((s) => s.toLocaleString("en-US")).join(" → ")}`}>
            <Select id="bench-sizes" value={presetKey} onChange={(e) => setPreset(e.target.value as PresetKey)}>
              {(Object.keys(PRESETS) as PresetKey[])
                .filter((k) => target === "sandbox" || !PRESETS[k].privateOnly)
                .map((k) => (
                <option key={k} value={k}>
                  {PRESETS[k].label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <InlineError error={start.error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => setConfirm(true)} disabled={running || unfunded} loading={start.isPending}>
            <Play className="size-4" aria-hidden /> Start run
          </Button>
          {running ? <span className="text-sm text-muted">A run is in progress.</span> : null}
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        loading={start.isPending}
        title="Start a slow-query run?"
        confirmLabel="Start run"
        description={
          <>
            {TARGETS[target].confirm} The runner checks node health first and pauses automatically if head lag grows or host CPU passes 85 %.
          </>
        }
        onConfirm={() =>
          start.mutate(target === "readonly" ? { target } : { target, sizes: [...sizes] }, {
            onSuccess: (run) => {
              setConfirm(false);
              onStarted(run.id);
              pushToast({ tone: "info", title: "Benchmark started", body: `${run.id} on ${run.target}` });
            },
            onError: () => setConfirm(false),
          })
        }
      />
    </Card>
  );
}

export function RunProgress({ run }: { run: BenchRun }) {
  const pct = Math.round(run.progress * 100);
  const active = ACTIVE.includes(run.status);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={statusTone[run.status]}>{run.status}</StatusBadge>
        <span className="text-sm text-muted">
          {TARGETS[run.target]?.label ?? run.target} · sizes <span className="num">{run.sizes.map((s) => s.toLocaleString("en-US")).join(" / ")}</span>
        </span>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>Progress</span>
          <span className="num">{pct} %</span>
        </div>
        <div
          role="progressbar"
          aria-label={`Run ${run.id} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2 overflow-hidden rounded-full bg-surface-2"
        >
          <div className="h-full origin-left rounded-full bg-primary transition-transform duration-300 ease-out" style={{ transform: `scaleX(${run.progress})` }} />
        </div>
      </div>
      {run.message ? (
        <p className="text-sm text-fg" aria-live={active ? "polite" : "off"}>
          {run.message}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Started</dt>
        <dd className="num text-right sm:text-left">{fmtDateTime(run.startedAt)}</dd>
        <dt className="text-muted">Duration</dt>
        <dd className="num text-right sm:text-left">
          {fmtDuration(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)}
          {active ? " so far" : ""}
        </dd>
      </dl>
    </div>
  );
}

/** A shape name that opens the shape explorer. */
export function ShapeButton({ name, onOpen, slow }: { name: string; onOpen: () => void; slow?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="num inline-flex min-h-8 items-center gap-1 rounded px-1 text-left text-sm whitespace-nowrap text-primary hover:bg-surface-2 hover:underline"
    >
      {slow ? <span className="text-warn" aria-hidden>▲</span> : null}
      {name}
      {slow ? <span className="sr-only"> (slow)</span> : null}
    </button>
  );
}

export function VerdictBadge({ slow }: { slow: boolean }) {
  return slow ? <StatusBadge tone="warn">slow</StatusBadge> : <StatusBadge tone="ok">ok</StatusBadge>;
}
