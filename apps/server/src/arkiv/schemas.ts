// Named Arkiv schemas written by Nodewatch. A named schema tags every entity with an indexed
// `arkiv.schema` attribute holding its name (SDK: SCHEMA_ATTRIBUTE); fleet/bundle queries filter on it.
import { addr, bytes, dec, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";

export const SCHEMA_ATTRIBUTE = "arkiv.schema";
export const HEARTBEAT_SCHEMA_NAME = "nodewatch.heartbeat";
export const BUNDLE_SCHEMA_NAME = "nodewatch.bundle";
export const BENCH_SCHEMA_NAME = "nwbench.item";
export const PROFILE_SCHEMA_NAME = "nodewatch.profile";

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
  /** Operator-chosen display name (Settings → Autopilot). Empty when unset. */
  label: str(),
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

/**
 * Operator-chosen node profile. `signature` is the provider key's EIP-191 signature over profileMessage() (shared),
 * so readers can check the provider really chose it; the writer (heartbeat key) cannot forge it. 65 bytes, so it
 * lives in a bytes column (strings hold at most 128 bytes and are indexed-capable, which this does not need).
 */
export const ProfileEntity = defineSchema(PROFILE_SCHEMA_NAME, {
  provider: addr().indexed(),
  country: str().indexed(),
  name: str(),
  contact: str(),
  issuedAt: u64(),
  signature: bytes(),
  agentVersion: str(),
});
