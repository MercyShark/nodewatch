// Verdict engine: ordered rules, first match wins (CLAUDE.md §5.3).
import type { ContainerState, Severity, Verdict, VerdictCode } from "@nodewatch/shared";

export const EXPECTED_CHAIN_ID = 0x76edaf;
export const LAG_THRESHOLD = 10;

export interface VerdictInput {
  kitDir: string;
  dockerAvailable: boolean;
  containers: ContainerState[];
  recentRestarts: (service: ContainerState["service"]) => number;
  kernelOomRecent: boolean;
  diskFree: number | null;
  diskTotal: number | null;
  elReachable: boolean;
  chainId: number | null;
  expectedChainId: number;
  elSyncing: boolean | null;
  headLag: number | null; // null when the reference RPC is failing → no lag verdict
  catchUpBlocksPerMin: number | null;
  elPeers: number | null;
  clReachable: boolean;
  clElOffline: boolean | null;
  clPeers: number | null;
  tunnelProfileOn: boolean;
  tunnelRunning: boolean | null;
  marketplaceKnown: boolean;
  providerConfigured: boolean;
  agreementLive: boolean;
  lowGas: { who: string; balance: number }[];
  lowGasThreshold: number;
  rpcRequestsPerMin: number | null;
  proxyInline: boolean;
}

type V = Omit<Verdict, "since">;

const v = (code: VerdictCode, severity: Severity | "ok", title: string, detail: string, fix: string | null): V => ({
  code,
  severity,
  title,
  detail,
  fix,
});

export function evaluateVerdict(i: VerdictInput): V {
  const kit = `cd ${i.kitDir}`;
  const core = i.containers.filter((c) => c.service === "execution" || c.service === "consensus");

  // 1. container_down
  if (i.dockerAvailable) {
    const down = core.find((c) => !c.running);
    if (down) {
      return v(
        "container_down",
        "critical",
        `The ${down.service} container is not running.`,
        `${down.name} is stopped${down.lastErrorLine ? `; last error: ${down.lastErrorLine}` : ""}. The node cannot serve requests until it is back.`,
        `${kit} && docker compose logs --tail 100 ${down.service} && ./setup.sh`,
      );
    }
    const looping = core.find((c) => i.recentRestarts(c.service) >= 3);
    if (looping) {
      return v(
        "container_down",
        "critical",
        `The ${looping.service} container is restart-looping.`,
        `${looping.name} restarted ${i.recentRestarts(looping.service)} times in the last 15 minutes.`,
        `${kit} && docker compose logs --tail 200 ${looping.service}`,
      );
    }
  }
  if (!i.elReachable) {
    return v(
      "container_down",
      "critical",
      "The execution client is not answering JSON-RPC.",
      i.dockerAvailable
        ? "The container is up but the RPC port does not respond."
        : "Docker is not visible to Nodewatch, and the execution RPC does not respond.",
      `${kit} && docker compose logs --tail 100 execution && ./setup.sh`,
    );
  }

  // 2. oom
  const oom = i.containers.find((c) => c.oomKilled);
  if (oom || i.kernelOomRecent) {
    return v(
      "oom",
      "critical",
      oom ? `The ${oom.service} container was killed for running out of memory.` : "The kernel killed a process for running out of memory.",
      "Check the memory panel for the container that grew. Out-of-memory kills drop the node from rotation while it restarts.",
      "Check the memory panel; add memory (larger instance type) if the node keeps hitting the limit",
    );
  }

  // 3. disk_full
  if (i.diskFree !== null && i.diskTotal && i.diskFree / i.diskTotal < 0.02) {
    return v(
      "disk_full",
      "critical",
      "The disk is almost full.",
      `Only ${(i.diskFree / 1e9).toFixed(1)} GB (${((100 * i.diskFree) / i.diskTotal).toFixed(1)} %) is free. The node stops syncing when it runs out.`,
      "Raise root_volume_gib, terraform apply, then: sudo growpart /dev/nvme0n1 1 && sudo resize2fs /dev/nvme0n1p1",
    );
  }

  // 4. wrong_chain
  if (i.chainId !== null && i.chainId !== i.expectedChainId) {
    return v(
      "wrong_chain",
      "critical",
      "The node is on the wrong chain.",
      `eth_chainId is 0x${i.chainId.toString(16)}, expected 0x${i.expectedChainId.toString(16)} (Rabdi).`,
      `${kit} && grep NETWORK .env  # expect NETWORK=rabdi, then ./setup.sh --refresh`,
    );
  }

  // 5. el_offline
  if (i.clElOffline === true) {
    return v(
      "el_offline",
      "critical",
      "The consensus client cannot reach the execution client.",
      "Lighthouse reports el_offline: it has no working engine API connection, so the head does not advance.",
      `${kit} && docker compose restart execution`,
    );
  }

  // 6. lagging
  if (i.elSyncing === true || (i.headLag !== null && i.headLag > LAG_THRESHOLD)) {
    const eta =
      i.headLag !== null && i.catchUpBlocksPerMin !== null && i.catchUpBlocksPerMin > 0
        ? ` At the current catch-up rate (${i.catchUpBlocksPerMin.toFixed(1)} blocks/min) it needs about ${formatMinutes(i.headLag / i.catchUpBlocksPerMin)}.`
        : "";
    return v(
      "lagging",
      "warning",
      i.headLag !== null ? `The node is ${i.headLag} blocks behind the network.` : "The node is still syncing.",
      `The load balancer takes nodes out of rotation when they fall behind.${eta}`,
      `${kit} && docker compose logs --tail 100 execution consensus`,
    );
  }

  // 7. no_peers
  if (i.elPeers === 0 || i.clPeers === 0) {
    const which = i.elPeers === 0 && i.clPeers === 0 ? "execution and consensus clients have" : i.elPeers === 0 ? "execution client has" : "consensus client has";
    return v("no_peers", "warning", `The ${which} no peers.`, "Without peers the node cannot follow the chain.", `${kit} && ./setup.sh --refresh`);
  }

  // 8. tunnel_down
  if (i.tunnelProfileOn && i.tunnelRunning === false) {
    return v(
      "tunnel_down",
      "critical",
      "The tunnel to the load balancer is down, so the node is out of rotation.",
      "frpc is not running or its proxy is not in the running state; the community load balancer cannot reach this node.",
      `${kit} && docker compose logs --tail 100 tunnel && ./marketplace.sh start-tunnel`,
    );
  }

  // 9. no_agreement
  if (i.marketplaceKnown && i.providerConfigured && !i.agreementLive) {
    return v(
      "no_agreement",
      "warning",
      "There is no live agreement for this provider, so the pool sends no traffic.",
      "No rpc.agreement entity from the load balancer names this provider address.",
      `${kit} && ./marketplace.sh post-offer`,
    );
  }

  // 10. low_gas
  if (i.lowGas.length) {
    const w = i.lowGas.map((g) => `${g.who} ${g.balance.toFixed(3)} tGLM`).join(", ");
    return v(
      "low_gas",
      "warning",
      "A wallet used by this node is low on tGLM.",
      `${w} (threshold ${i.lowGasThreshold} tGLM). Heartbeats and marketplace writes need gas.`,
      "Top up at https://hub.arkiv.network/faucet",
    );
  }

  // 11. healthy
  const rpm = i.proxyInline && i.rpcRequestsPerMin !== null ? ` Serving ${i.rpcRequestsPerMin.toFixed(0)} requests/min.` : "";
  return v("healthy", "ok", "The node is healthy and in sync.", `All checks pass.${rpm}`, null);
}

function formatMinutes(m: number): string {
  if (!Number.isFinite(m)) return "an unknown time";
  if (m < 1) return "under a minute";
  if (m < 90) return `${Math.round(m)} minutes`;
  if (m < 48 * 60) return `${(m / 60).toFixed(1)} hours`;
  return `${(m / 1440).toFixed(1)} days`;
}
