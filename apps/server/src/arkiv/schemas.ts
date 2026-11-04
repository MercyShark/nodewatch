// Named Arkiv schemas written by Nodewatch. A named schema tags every entity with an indexed
// `arkiv.schema` attribute holding its name (SDK: SCHEMA_ATTRIBUTE); fleet/bundle queries filter on it.
import { addr, dec, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";

export const SCHEMA_ATTRIBUTE = "arkiv.schema";
export const HEARTBEAT_SCHEMA_NAME = "nodewatch.heartbeat";
export const BUNDLE_SCHEMA_NAME = "nodewatch.bundle";
export const BENCH_SCHEMA_NAME = "nwbench.item";

export const Heartbeat = defineSchema(HEARTBEAT_SCHEMA_NAME, {
  provider: addr().indexed(),
  status: str().indexed(),
  verdict: str().indexed(),
  headLag: u64().indexed(),
  diskDaysLeft: dec().indexed(),
  peersEl: u64(),
  peersCl: u64(),
  client: str(),
  agentVersion: str(),
});

export const BundleEntity = defineSchema(BUNDLE_SCHEMA_NAME, {
  provider: addr().indexed(),
  kind: str().indexed(),
  recipient: addr().indexed(),
  swarmRef: str(),
  sha256: str(),
  scheme: str(),
  sizeBytes: u64(),
});
