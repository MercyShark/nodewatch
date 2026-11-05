import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AlertsResponse,
  BackupsResponse,
  BenchCatalog,
  BenchRun,
  Bundle,
  ChainResponse,
  ChannelName,
  DiskForecast,
  FleetResponse,
  Overview,
  PoolResponse,
  Range,
  ResourcesResponse,
  RpcResponse,
  SessionUser,
  Silence,
  VaultResponse,
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

export const usePool = () =>
  useQuery({ queryKey: ["pool"], queryFn: () => api<PoolResponse>("/pool"), refetchInterval: 60_000 });

export const useRpc = (range: Range, paused = false) =>
  useQuery({
    queryKey: ["rpc", range],
    queryFn: () => api<RpcResponse>(`/rpc?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: liveInterval(range, paused),
  });

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
