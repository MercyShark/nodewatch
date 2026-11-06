import { useState, type FormEvent } from "react";
import { BellOff, BellRing, History, Route, Send, Siren, Trash2 } from "lucide-react";
import type { AlertEvent, AlertsResponse, ChannelName, Silence } from "@nodewatch/shared";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Hex } from "@/components/ui/copy";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/form";
import { Badge, StatusBadge, ToneIcon, severityTone } from "@/components/ui/status";
import { DataTable, type Column } from "@/components/ui/table";
import { useNow } from "@/components/ui/time";
import { StaggerItem, useFirstLoad } from "@/components/ui/stagger-item";
import { AdminOnly, useIsAdmin } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { DASH, fmtAgo, fmtDateTime, fmtDuration } from "@/lib/format";
import { useAlerts, useCreateSilence, useDeleteSilence, useSendTestAlert } from "@/lib/queries";
import { pushToast } from "@/lib/toast";

const RULES = [
  "DiskDaysLeftLow",
  "DiskDaysLeftCritical",
  "NodeLagging",
  "NoPeers",
  "ContainerDown",
  "OOMKilled",
  "TunnelDown",
  "AgreementExpiringSoon",
  "HeartbeatFailing",
  "LowGas",
  "BackupFailed",
  "RPCErrorRateHigh",
  "RPCLatencyHigh",
  "HostCPUHigh",
  "HostMemoryHigh",
];
const DURATIONS = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "24 hours" },
];

const CHANNEL_META: Record<ChannelName, { label: string; icon: typeof Send; env: string; severities: string }> = {
  telegram: { label: "Telegram", icon: Send, env: "TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID", severities: "info, warning, critical + slow requests (over 750 ms), one digest a minute" },
  pagerduty: { label: "PagerDuty", icon: Siren, env: "PAGERDUTY_ROUTING_KEY", severities: "critical only" },
};

const SEV_LABEL: Record<AlertEvent["severity"], string> = { info: "Info", warning: "Warning", critical: "Critical" };

function ChannelCard({ ch, now }: { ch: AlertsResponse["channels"][number]; now: number }) {
  const meta = CHANNEL_META[ch.name];
  const test = useSendTestAlert();
  const pending = test.isPending && test.variables === ch.name;
  const send = () =>
    test.mutate(ch.name, {
      onSuccess: () => pushToast({ tone: "ok", title: `Test sent to ${meta.label}`, body: "Check the channel." }),
      onError: (e) => pushToast({ tone: "crit", title: `${meta.label} test failed`, body: errorMessage(e) }),
    });
  const Icon = meta.icon;
  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        icon={<Icon />}
        title={meta.label}
        actions={
          ch.configured ? <StatusBadge tone="ok">Configured</StatusBadge> : <StatusBadge tone="neutral">Not configured</StatusBadge>
        }
      />
      <CardBody className="flex flex-1 flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted">Last send</dt>
            <dd className="num text-fg" title={ch.lastSendAt ? fmtDateTime(ch.lastSendAt) : undefined}>
              {ch.lastSendAt ? fmtAgo(ch.lastSendAt, now) : "never"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Receives</dt>
            <dd className="text-fg">{meta.severities}</dd>
          </div>
        </dl>
        {!ch.configured ? (
          <p className="text-xs text-muted">
            Set <code className="num text-fg">{meta.env}</code> to enable.
          </p>
        ) : null}
        {ch.lastError ? <InlineError error={`Last error: ${ch.lastError}`} /> : null}
        <div className="mt-auto pt-1">
          <AdminOnly>
            <Button size="sm" onClick={send} loading={pending} disabled={!ch.configured} title={ch.configured ? undefined : "Configure the channel first"}>
              {!pending ? <BellRing className="size-4" aria-hidden /> : null}
              Send test
            </Button>
          </AdminOnly>
        </div>
      </CardBody>
    </Card>
  );
}

function RoutingCard() {
  const rows: [string, string][] = [
    ["Info", "Telegram"],
    ["Warning", "Telegram"],
    ["Critical", "Telegram, PagerDuty"],
    ["Requests over 750 ms", "Telegram, once a minute"],
  ];
  return (
    <Card className="h-full">
      <CardHeader icon={<Route />} title="Routing" description="Evaluated every 15 s, grouped over 30 s." />
      <CardBody>
        <ul className="flex flex-col gap-2">
          {rows.map(([sev, to]) => (
            <li key={sev} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg/50 px-3 py-2">
              <StatusBadge tone={severityTone(sev.toLowerCase())}>{sev}</StatusBadge>
              <span className="text-sm text-fg">{to}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Resolves are sent too. ContainerDown suppresses NodeLagging. If the host dies, its Arkiv heartbeat expires and other fleet views show it
          gone.
        </p>
      </CardBody>
    </Card>
  );
}

function ActiveCard({ active, now }: { active: AlertEvent[]; now: number }) {
  return (
    <Card>
      <CardHeader
        icon={<BellRing />}
        title="Active alerts"
        actions={active.length ? <Badge className="num">{active.length} firing</Badge> : null}
      />
      <CardBody>
        {active.length === 0 ? (
          <div className="flex items-center gap-2 py-3 text-sm text-fg">
            <ToneIcon tone="ok" />
            Nothing is firing.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-1 rounded-lg border border-border bg-bg/50 p-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <StatusBadge tone={severityTone(a.severity)} className="self-start sm:self-center">
                  {SEV_LABEL[a.severity]}
                </StatusBadge>
                <div className="min-w-0 flex-1">
                  <p className="num text-sm font-semibold text-fg">{a.rule}</p>
                  <p className="text-sm text-muted">{a.summary}</p>
                </div>
                <p className="num text-xs whitespace-nowrap text-muted" title={fmtDateTime(a.startedAt)}>
                  for {fmtDuration((now - a.startedAt) / 1000)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function HistoryCard({ history }: { history: AlertEvent[] }) {
  const columns: Column<AlertEvent>[] = [
    { key: "rule", header: "Rule", cell: (a) => <span className="num text-xs text-fg">{a.rule}</span>, sort: (a) => a.rule },
    {
      key: "severity",
      header: "Severity",
      cell: (a) => <StatusBadge tone={severityTone(a.severity)}>{SEV_LABEL[a.severity]}</StatusBadge>,
      sort: (a) => ["info", "warning", "critical"].indexOf(a.severity),
      hideBelow: "sm",
    },
    {
      key: "status",
      header: "Status",
      cell: (a) =>
        a.status === "resolved" ? <StatusBadge tone="ok">Resolved</StatusBadge> : <StatusBadge tone={severityTone(a.severity)}>Firing</StatusBadge>,
      sort: (a) => a.status,
    },
    { key: "summary", header: "Summary", cell: (a) => <span className="text-sm text-muted">{a.summary}</span>, hideBelow: "md" },
    { key: "started", header: "Started", cell: (a) => <span className="num text-xs">{fmtDateTime(a.startedAt)}</span>, sort: (a) => a.startedAt },
    {
      key: "resolved",
      header: "Resolved",
      cell: (a) => <span className="num text-xs">{a.resolvedAt ? fmtDateTime(a.resolvedAt) : DASH}</span>,
      sort: (a) => a.resolvedAt,
      hideBelow: "lg",
    },
    {
      key: "duration",
      header: "Duration",
      align: "right",
      cell: (a) => (a.resolvedAt ? fmtDuration((a.resolvedAt - a.startedAt) / 1000) : "ongoing"),
      sort: (a) => (a.resolvedAt ?? Date.now()) - a.startedAt,
      hideBelow: "lg",
    },
  ];
  return (
    <Card>
      <CardHeader icon={<History />} title="History" description="Newest first." />
      <CardBody>
        <DataTable
          rows={history}
          columns={columns}
          rowKey={(a) => `${a.id}-${a.status}`}
          caption="Alert history"
          initialSort={{ key: "started", dir: "desc" }}
          maxHeight={480}
          empty={<EmptyState title="No alerts yet" />}
        />
      </CardBody>
    </Card>
  );
}

function NewSilenceForm() {
  const create = useCreateSilence();
  const [rule, setRule] = useState<string>("");
  const [minutes, setMinutes] = useState(60);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { rule: rule === "" ? null : rule, minutes },
      {
        onSuccess: () =>
          pushToast({
            tone: "info",
            title: "Silence created",
            body: `${rule || "All rules"} muted for ${DURATIONS.find((d) => d.minutes === minutes)?.label ?? `${minutes} min`}.`,
          }),
      },
    );
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-bg/50 p-3" aria-label="New silence">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rule" htmlFor="silence-rule" hint="Mutes notifications only; alerts are still recorded.">
          <Select id="silence-rule" value={rule} onChange={(e) => setRule(e.target.value)} aria-describedby="silence-rule-hint">
            <option value="">All rules</option>
            {RULES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Duration" htmlFor="silence-duration">
          <Select id="silence-duration" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {create.error ? <InlineError error={create.error} /> : null}
      <div>
        <Button type="submit" variant="primary" size="sm" loading={create.isPending}>
          {!create.isPending ? <BellOff className="size-4" aria-hidden /> : null}
          Create silence
        </Button>
      </div>
    </form>
  );
}

function SilencesCard({ silences, now }: { silences: Silence[]; now: number }) {
  const admin = useIsAdmin();
  const del = useDeleteSilence();
  const [target, setTarget] = useState<Silence | null>(null);
  return (
    <Card className="h-full">
      <CardHeader icon={<BellOff />} title="Silences" description="Muted until they expire." />
      <CardBody className="flex flex-col gap-3">
        {silences.length === 0 ? (
          <p className="text-sm text-muted">No active silences.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {silences.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border border-border bg-bg/50 py-2 pr-1 pl-3">
                <div className="min-w-0 flex-1">
                  <p className="num text-sm font-semibold text-fg">{s.rule ?? "All rules"}</p>
                  <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
                    <span className="num">ends in {fmtDuration(Math.max(0, (s.until - now) / 1000))}</span>
                    <span aria-hidden>·</span>
                    <span>by</span>
                    {/^0x[0-9a-fA-F]{40}$/.test(s.createdBy) ? (
                      <Hex value={s.createdBy} copy={false} className="[&_span]:text-xs" />
                    ) : (
                      <span className="num">{s.createdBy}</span>
                    )}
                  </p>
                </div>
                {admin ? (
                  <Button variant="danger" size="sm" onClick={() => setTarget(s)} aria-label={`Delete silence for ${s.rule ?? "all rules"}`}>
                    <Trash2 className="size-4" aria-hidden />
                    <span className="hidden sm:inline">Delete</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <AdminOnly fallback={<p className="text-xs text-muted">Only admins can create or remove silences.</p>}>
          <NewSilenceForm />
        </AdminOnly>
      </CardBody>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="Delete this silence?"
        description={
          <>
            Notifications for <strong className="text-fg">{target?.rule ?? "all rules"}</strong> resume now, including anything still firing.
          </>
        }
        confirmLabel="Delete silence"
        destructive
        loading={del.isPending}
        onConfirm={() => {
          if (!target) return;
          del.mutate(target.id, {
            onSuccess: () => {
              pushToast({ tone: "info", title: "Silence removed", body: target.rule ?? "All rules" });
              setTarget(null);
            },
            onError: (e) => pushToast({ tone: "crit", title: "Could not delete silence", body: errorMessage(e) }),
          });
        }}
      />
    </Card>
  );
}

export default function AlertsPage() {
  const q = useAlerts();
  const now = useNow(15_000);
  const first = useFirstLoad("alerts");
  const data = q.data;
  return (
    <>
      <PageHeader
        title="Alerts"
        description="Channels, firing alerts, silences and history."
        actions={data ? (data.active.length ? <StatusBadge tone="warn">{data.active.length} firing</StatusBadge> : <StatusBadge tone="ok">All clear</StatusBadge>) : null}
      />
      {q.isLoading ? (
        <div role="status" aria-label="Loading alerts" className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : q.error && !data ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : data ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            {data.channels.map((ch, i) => (
              <StaggerItem key={ch.name} index={i} first={first}>
                <ChannelCard ch={ch} now={now} />
              </StaggerItem>
            ))}
          </div>
          <StaggerItem index={3} first={first}>
            <ActiveCard active={data.active} now={now} />
          </StaggerItem>
          <div className="grid gap-4 lg:grid-cols-2">
            <StaggerItem index={4} first={first}>
              <SilencesCard silences={data.silences} now={now} />
            </StaggerItem>
            <StaggerItem index={5} first={first}>
              <RoutingCard />
            </StaggerItem>
          </div>
          <StaggerItem index={6} first={first}>
            <HistoryCard history={data.history} />
          </StaggerItem>
        </div>
      ) : null}
    </>
  );
}
