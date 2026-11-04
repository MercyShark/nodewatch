import type { Analyzer } from "./analyzer/index.js";
import type { AlertEngine } from "./alerts/engine.js";
import type { FleetReader } from "./arkiv/fleet.js";
import type { HeartbeatWriter } from "./arkiv/heartbeat.js";
import type { Sessions } from "./auth/session.js";
import type { Backups } from "./backup/index.js";
import type { Bench } from "./bench/runner.js";
import type { RpcStats } from "./proxy/rpcProxy.js";
import type { Vault } from "./swarm/vault.js";

/** Long-lived subsystems the HTTP layer calls into. */
export interface Services {
  sessions: Sessions;
  analyzer: Analyzer;
  alerts: AlertEngine;
  rpcStats: RpcStats;
  fleet: FleetReader;
  heartbeat: HeartbeatWriter;
  vault: Vault;
  backups: Backups;
  bench: Bench;
}
