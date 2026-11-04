import type { Config } from "./config.js";
import type { DB } from "./db/index.js";
import type { AllowlistedDocker } from "./docker/client.js";
import type { Logger } from "./log.js";
import type { Bus, LiveState } from "./state.js";
import type { Tsdb } from "./tsdb/index.js";

/** Everything a subsystem needs; built once in index.ts (or in tests). */
export interface Ctx {
  cfg: Config;
  db: DB;
  tsdb: Tsdb;
  state: LiveState;
  bus: Bus;
  docker: AllowlistedDocker;
  log: Logger;
}
