"use client";

import { useId, useState, type FormEvent } from "react";
import { Bot, KeyRound, Lock, LockOpen, Play, Tag } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Hex } from "@/components/ui/copy";
import { ErrorState, InlineError, Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge, ToneIcon } from "@/components/ui/status";
import { explorerTx } from "@/lib/config";
import { fmtAgo } from "@/lib/format";
import { useAutopilot, useAutopilotAction, useAutopilotUnlock, useAutopilotUpdate } from "@/lib/queries";
import { pushToast } from "@/lib/toast";
import { cn } from "@/lib/cn";

const ACTION_LABEL: Record<string, string> = {
  "post-offer": "Posted an offer",
  "tunnel-config": "Configured the tunnel",
  "tunnel-start": "Started the tunnel",
  toggle: "Autopilot switched",
  label: "Label changed",
  error: "Problem",
};

/**
 * Autopilot: Nodewatch keeps the node in the pool on its own. Re-posts the offer before the agreement lapses, signs
 * the tunnel token and restarts the tunnel for a new agreement, restarts the tunnel when it exits. Needs the provider
 * key unlocked (in memory only) once per Nodewatch restart, or PROVIDER_KEYSTORE_PASSWORD in .env.
 */
export function AutopilotCard() {
  const q = useAutopilot(true);
  const update = useAutopilotUpdate();
  const unlock = useAutopilotUnlock();
  const lock = useAutopilotAction("lock");
  const run = useAutopilotAction("run");
  const [pw, setPw] = useState("");
  const [label, setLabel] = useState<string | null>(null);
  const pwId = useId();
  const labelId = useId();
  const s = q.data;

  const submitUnlock = (e: FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    unlock.mutate(pw, {
      onSuccess: () => {
        setPw("");
        pushToast({ tone: "ok", title: "Provider key unlocked", body: "Held in memory only, until Nodewatch restarts or you lock it." });
      },
    });
  };
  const saveLabel = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ label }, { onSuccess: () => pushToast({ tone: "ok", title: "Label saved", body: "Published in the next heartbeat and the next offer." }) });
  };

  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.error || !s)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Card>
    );

  const blocked = s.keystoreError ?? (s.enabled && !s.keyUnlocked ? "The provider key is locked. Unlock it so the autopilot can post offers and sign tunnel tokens." : null) ?? (s.enabled ? s.kitWritable : null);
  const tone = !s.enabled ? "neutral" : blocked ? "warn" : s.lastError ? "warn" : "ok";

  return (
    <Card>
      <CardHeader
        title="Autopilot"
        icon={<Bot />}
        description="Keeps this node in the pool without you: re-posts the offer before the agreement lapses, signs the tunnel token and restarts the tunnel for a new agreement, restarts the tunnel when it exits."
        actions={
          <Segmented
            size="sm"
            label="Autopilot"
            value={s.enabled ? "on" : "off"}
            onChange={(v) => update.mutate({ enabled: v === "on" })}
            options={[
              { value: "off", label: "Off" },
              { value: "on", label: "On" },
            ]}
          />
        }
      />
      <CardBody className="flex flex-col gap-5">
        <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", tone === "ok" ? "border-ok/35 bg-ok/5" : tone === "warn" ? "border-warn/45 bg-warn/5" : "border-border bg-surface-2/50")}>
          <ToneIcon tone={tone === "neutral" ? "neutral" : tone} className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-fg">{blocked ?? s.next}</p>
            <p className="mt-0.5 text-xs text-muted">
              {s.lastRun ? `last check ${fmtAgo(s.lastRun)}` : "not checked yet"}
              {s.lastError && !blocked ? ` · last error: ${s.lastError}` : ""}
              {s.tunnelConfiguredFor ? (
                <>
                  {" "}
                  · tunnel configured for <span className="num">{s.tunnelConfiguredFor.slice(0, 10)}…</span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="flex flex-col gap-3" aria-labelledby={`${pwId}-h`}>
            <h3 id={`${pwId}-h`} className="flex items-center gap-2 text-sm font-medium text-fg">
              <KeyRound className="size-4 text-muted" aria-hidden /> Provider key
            </h3>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted">Address</span>
              {s.providerAddress ? <Hex value={s.providerAddress} /> : <span className="text-muted">not found</span>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted">State</span>
              {s.keyUnlocked ? (
                <StatusBadge tone="ok">
                  <LockOpen className="size-3.5" aria-hidden /> unlocked in memory{s.keyUnlockedAt ? ` · ${fmtAgo(s.keyUnlockedAt)}` : ""}
                </StatusBadge>
              ) : (
                <StatusBadge tone="neutral">
                  <Lock className="size-3.5" aria-hidden /> locked
                </StatusBadge>
              )}
            </div>
            {s.keyUnlocked ? (
              <Button size="sm" onClick={() => lock.mutate()} loading={lock.isPending} className="self-start">
                Lock now
              </Button>
            ) : (
              <form onSubmit={submitUnlock} className="flex flex-col gap-2">
                <Field label="Keystore password" htmlFor={pwId} hint="Used once to decrypt the keystore in memory. Never stored, never logged.">
                  <Input id={pwId} type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} disabled={!!s.keystoreError} />
                </Field>
                <InlineError error={unlock.error} />
                <Button type="submit" variant="primary" size="sm" loading={unlock.isPending} disabled={!pw || !!s.keystoreError} className="self-start">
                  <LockOpen className="size-4" aria-hidden /> Unlock
                </Button>
              </form>
            )}
            <p className="text-xs text-muted">For zero-touch across restarts set PROVIDER_KEYSTORE_PASSWORD in /opt/nodewatch/.env (mode 600).</p>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby={`${labelId}-h`}>
            <h3 id={`${labelId}-h`} className="flex items-center gap-2 text-sm font-medium text-fg">
              <Tag className="size-4 text-muted" aria-hidden /> Node label
            </h3>
            <form onSubmit={saveLabel} className="flex flex-col gap-2">
              <Field label="Display name" htmlFor={labelId} hint="Published in this node's heartbeat (Fleet views) and in the offer payload the load balancer reads. nodes.arkiv.network labels are set by Arkiv's team.">
                <Input id={labelId} maxLength={64} value={label ?? s.label ?? ""} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Mumbai node 1" />
              </Field>
              <InlineError error={update.error} />
              <Button type="submit" size="sm" loading={update.isPending} disabled={label === null || label === (s.label ?? "")} className="self-start">
                Save label
              </Button>
            </form>
          </section>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-fg">Recent actions</h3>
            <Button size="sm" onClick={() => run.mutate()} loading={run.isPending} disabled={!s.enabled}>
              <Play className="size-4" aria-hidden /> Check now
            </Button>
          </div>
          {s.recent.length ? (
            <ol className="flex flex-col divide-y divide-border/60 text-sm">
              {s.recent.slice(0, 8).map((r) => (
                <li key={r.ts + r.action} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 py-2">
                  <ToneIcon tone={r.ok ? "ok" : "warn"} className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="text-fg">{ACTION_LABEL[r.action] ?? r.action}</span>
                    <span className="text-muted"> · {r.message}</span>
                    {r.tx_hash ? (
                      <>
                        {" "}
                        <Hex value={r.tx_hash} href={explorerTx(r.tx_hash)} copy={false} />
                      </>
                    ) : null}
                  </span>
                  <span className="num text-xs whitespace-nowrap text-muted">{fmtAgo(r.ts)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">Nothing yet. With autopilot on, actions appear here as they happen.</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
