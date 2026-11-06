import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AlertsResponse,
  BackupsResponse,
  AutopilotState,
  BenchCatalog,
  BenchRun,
  BenchWriter,
  Bundle,
  ChainResponse,
  ChannelName,
  CleanupItemId,
  CleanupPreview,
  CleanupResult,
  DiskForecast,
  FleetResponse,
  FixAction,
  NodeProfileFields,
  NodeProfileState,
  Overview,
  UpdateState,
  PoolResponse,
  Range,
  ResourcesResponse,
  RpcResponse,
  SessionUser,
  Silence,
  VaultResponse,
  LiveQueriesResponse,
} from "@nodewatch/shared";
import { api, isUnauthorized } from "./api";

/** Polling intervals for live ranges (SSE handles overview). */
const LIVE_MS = 15_000;
const liveInterval = (range: Range, paused: boolean) => (paused ? false : range === "1h" || range === "6h" ? LIVE_MS : 60_000);

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        const r = await api<SessionUser | { user: SessionUser | null }>("/auth/me");
        if (r && typeof r === "object" && "user" in r) return r.user;
        return r as SessionUser;
      } catch (e) {
        if (isUnauthorized(e)) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: 1,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<unknown>("/auth/logout", { method: "POST" }),
    onSettled: () => {
      // Keep the ["me"] query (the auth gate observes it); drop everything else.
      qc.setQueryData(["me"], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
  });
}

export const useOverview = () =>
  useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/overview"), refetchInterval: 60_000 });

export const useResources = (range: Range, paused = false) =>
  useQuery({
    queryKey: ["resources", range],
    queryFn: () => api<ResourcesResponse>(`/resources?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: liveInterval(range, paused),
  });

export const useDiskForecast = () =>
  useQuery({ queryKey: ["disk-forecast"], queryFn: () => api<DiskForecast>("/disk/forecast"), refetchInterval: 300_000 });

export const useChain = (range: Range, paused = false) =>
  useQuery({
    queryKey: ["chain", range],
    queryFn: () => api<ChainResponse>(`/chain?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: liveInterval(range, paused),
  });

export const useAutopilot = (enabled: boolean) =>
  useQuery({ queryKey: ["autopilot"], queryFn: () => api<AutopilotState>("/autopilot"), enabled, refetchInterval: 30_000 });

export function useAutopilotUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { enabled?: boolean; label?: string | null }) => api<AutopilotState>("/autopilot", { method: "PUT", body: b }),
    onSuccess: (s) => qc.setQueryData(["autopilot"], s),
  });
}
export function useAutopilotUnlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api<AutopilotState>("/autopilot/unlock", { method: "POST", body: { password } }),
    onSuccess: (s) => qc.setQueryData(["autopilot"], s),
  });
}
export function useAutopilotAction(path: "lock" | "run") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<AutopilotState>(`/autopilot/${path}`, { method: "POST" }),
    onSuccess: (s) => {
      qc.setQueryData(["autopilot"], s);
      void qc.invalidateQueries({ queryKey: ["pool"] });
    },
  });
}

export const usePool = () =>
  useQuery({ queryKey: ["pool"], queryFn: () => api<PoolResponse>("/pool"), refetchInterval: 60_000 });

export const useRpc = (range: Range, paused = false) =>
  useQuery({
    queryKey: ["rpc", range],
    queryFn: () => api<RpcResponse>(`/rpc?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: liveInterval(range, paused),
  });

export const useLiveQueries = (range: Range, paused = false) =>
  useQuery({
    queryKey: ["queries", range],
    queryFn: () => api<LiveQueriesResponse>(`/queries?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: liveInterval(range, paused),
  });

export function useSetInline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api<LiveQueriesResponse & { message: string }>("/queries/inline", { method: "POST", body: { enabled } }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["queries"] });
      void qc.invalidateQueries({ queryKey: ["rpc"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export const useFleet = () =>
  useQuery({ queryKey: ["fleet"], queryFn: () => api<FleetResponse>("/fleet"), refetchInterval: 30_000 });

export const useAlerts = () =>
  useQuery({ queryKey: ["alerts"], queryFn: () => api<AlertsResponse>("/alerts"), refetchInterval: 30_000 });

export function useSendTestAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channel: ChannelName) => api<unknown>(`/alerts/test/${channel}`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export interface NewSilence {
  rule: string | null;
  minutes: number;
}
export function useCreateSilence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: NewSilence) => api<Silence>("/alerts/silences", { method: "POST", body: s }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}
export function useDeleteSilence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<unknown>(`/alerts/silences/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export const useBenchRuns = (enabled: boolean) =>
  useQuery({
    queryKey: ["bench", "runs"],
    queryFn: () => api<BenchRun[]>("/bench/runs"),
    enabled,
  });

/** Shape catalog: rarely changes, so it is cached for the session. */
export const useBenchCatalog = (enabled: boolean) =>
  useQuery({ queryKey: ["bench", "catalog"], queryFn: () => api<BenchCatalog>("/bench/catalog"), enabled, staleTime: Infinity });

/** Own-node writer address + tGLM balance (refreshes every 30 s while the page is open). */
export const useBenchWriter = (enabled: boolean) =>
  useQuery({ queryKey: ["bench", "writer"], queryFn: () => api<BenchWriter>("/bench/writer"), enabled, refetchInterval: 30_000 });

const ACTIVE: BenchRun["status"][] = ["queued", "seeding", "running", "paused"];
export const useBenchRun = (id: string | null) =>
  useQuery({
    queryKey: ["bench", "run", id],
    queryFn: () => api<BenchRun>(`/bench/runs/${encodeURIComponent(id ?? "")}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 2000 : false),
  });

export interface NewBenchRun {
  target: BenchRun["target"];
  sizes?: number[];
}
export function useStartBench() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: NewBenchRun) => api<BenchRun>("/bench/runs", { method: "POST", body: b }),
    onSuccess: (run) => {
      qc.setQueryData(["bench", "run", run.id], run);
      void qc.invalidateQueries({ queryKey: ["bench", "runs"] });
    },
  });
}

export const useVault = (enabled: boolean) =>
  useQuery({ queryKey: ["vault"], queryFn: () => api<VaultResponse>("/vault/bundles"), enabled });

export interface NewBundle {
  kind: Bundle["kind"];
  recipients: string[];
}
export function useCreateBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: NewBundle) => api<Bundle>("/vault/bundles", { method: "POST", body: b }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["vault"] }),
  });
}

export interface NewRecipient {
  label: string;
  message: string;
  signature: string;
  address: string;
}
export function useAddRecipient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: NewRecipient) => api<unknown>("/vault/recipients", { method: "POST", body: r }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["vault"] }),
  });
}

export const useBackups = (enabled: boolean) =>
  useQuery({ queryKey: ["backups"], queryFn: () => api<BackupsResponse>("/backups"), enabled });

export function useRunBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<unknown>("/backups/run", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["backups"] }),
  });
}

export function useTestRestore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | null) =>
      api<{ ok: boolean; message?: string }>("/backups/test-restore", { method: "POST", body: id ? { id } : {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["backups"] }),
  });
}

// ---- One-click fixes, disk cleanup, node profile (admin) ----

export function useFix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<{ message: string; action: FixAction }>("/fix", { method: "POST", body: { code } }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["autopilot"] });
    },
  });
}

export const useCleanupPreview = (enabled = true) =>
  useQuery({ queryKey: ["cleanup"], queryFn: () => api<CleanupPreview>("/disk/cleanup"), enabled, staleTime: 30_000 });

export function useCleanup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: CleanupItemId[]) => api<CleanupResult>("/disk/cleanup", { method: "POST", body: { items } }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["cleanup"] });
      void qc.invalidateQueries({ queryKey: ["resources"] });
    },
  });
}

export const useProfile = (enabled = true) =>
  useQuery({ queryKey: ["profile"], queryFn: () => api<NodeProfileState>("/profile"), enabled, staleTime: 15_000 });

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (f: NodeProfileFields) => api<NodeProfileState>("/profile", { method: "PUT", body: f }),
    onSuccess: (s) => qc.setQueryData(["profile"], s),
  });
}

export function usePublishProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ entityKey: string; txHash: string; state: NodeProfileState }>("/profile/publish", { method: "POST" }),
    onSuccess: (r) => {
      qc.setQueryData(["profile"], r.state);
      void qc.invalidateQueries({ queryKey: ["fleet"] });
    },
  });
}

// ---- Self-update (admin): check, then update only when the admin clicks ----

export const useUpdateState = (enabled = true) =>
  useQuery({ queryKey: ["update"], queryFn: () => api<UpdateState>("/update"), enabled, refetchInterval: 10 * 60_000, staleTime: 60_000 });

export function useUpdateCheck() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<UpdateState>("/update/check", { method: "POST" }), onSuccess: (s) => qc.setQueryData(["update"], s) });
}

export function useStartUpdate() {
  return useMutation({ mutationFn: () => api<{ message: string }>("/update", { method: "POST" }) });
}
