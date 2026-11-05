import { Info, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { useUser } from "@/lib/auth";
import { useOverview, useRpc } from "@/lib/queries";
import { explorerAddress } from "@/lib/config";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/status";
import { Hex } from "@/components/ui/copy";

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-[minmax(10rem,auto)_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Settings() {
  const user = useUser();
  const ov = useOverview();
  const rpc = useRpc("1h", true);
  const n = ov.data?.node;
  return (
    <>
      <PageHeader
        title="Settings & about"
        description="Read-only. Change values in the host's .env and restart the container."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Your session" icon={<UserRound />} />
          <CardBody>
            <Rows
              rows={[
                ["Role", <StatusBadge key="r" tone={user.role === "admin" ? "info" : "neutral"}>{user.role === "admin" ? "Admin" : "Viewer (read-only)"}</StatusBadge>],
                ["Sign-in method", user.method === "siwe" ? "Sign-In with Ethereum" : "Password"],
                ["Address", user.address ? <Hex key="a" value={user.address} full /> : "—"],
                ["Session", "12 h, httpOnly cookie"],
              ]}
            />
            <p className="mt-3 text-xs text-muted">
              Roles come from <code className="num">ADMIN_ADDRESSES</code> and <code className="num">VIEWER_ADDRESSES</code>. Viewers see no
              findings, secrets or destructive actions.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Node" icon={<Info />} />
          <CardBody>
            <Rows
              rows={[
                ["Instance", n?.instanceName ?? "—"],
                ["Network", n ? `${n.network} (chain ${n.chainId ?? "—"})` : "—"],
                ["Execution client", <span key="el" className="num text-xs">{n?.elVersion ?? "—"}</span>],
                ["Consensus client", <span key="cl" className="num text-xs">{n?.clVersion ?? "—"}</span>],
                [
                  "Provider address",
                  n?.providerAddress ? <Hex key="p" value={n.providerAddress} href={explorerAddress(n.providerAddress)} /> : "—",
                ],
              ]}
            />
            <p className="mt-3 flex items-start gap-2 text-xs text-muted">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
              Heartbeats use a separate hot key. The provider key is only held in memory while Autopilot is unlocked.
            </p>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Thresholds and intervals" icon={<SlidersHorizontal />} description="Defaults; override in .env." />
          <CardBody>
            <Rows
              rows={[
                ["Disk forecast", "warning < 7 d · critical < 2 d or < 20 GB free"],
                ["Head lag", "> 10 blocks for 5 m raises NodeLagging"],
                ["Heartbeat", "expires after 60 blocks, renewed every 30 s · 3 failed writes raise HeartbeatFailing"],
                ["Collectors", "host and containers 15 s · EL/CL 10 s · reference RPC ≤ 1/min · marketplace 5 min · balances 5 min"],
                ["Retention", "raw samples 48 h · 5-minute rollups 30 d"],
                ["Alert evaluation", "every 15 s · grouped over 30 s"],
                [
                  "RPC proxy mode",
                  rpc.data ? (
                    <StatusBadge key="pm" tone={rpc.data.proxyMode === "inline" ? "warn" : "info"}>
                      {rpc.data.proxyMode === "inline" ? "Inline (restart interrupts serving)" : "Passive"}
                    </StatusBadge>
                  ) : (
                    "—"
                  ),
                ],
                ["Resource cap", "Nodewatch 2 vCPU / 3 GiB · bench sandbox 3 vCPU / 6 GiB during a run"],
              ]}
            />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="About" icon={<Info />} />
          <CardBody className="flex flex-col gap-3 text-sm text-muted">
            <p>
              <span className="font-display tracking-wider text-fg">NODEWATCH</span>: an operations console for Arkiv nodes, one container next to
              the node. Built at ETHGlobal Mumbai 2026.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge>v{__APP_VERSION__}</Badge>
              <Badge>Apache-2.0</Badge>
              <Badge>Arkiv Rabdi · 7794095</Badge>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
