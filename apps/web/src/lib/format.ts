import { formatUnits } from "viem";

export const BLOCK_SECONDS = 2;
export const GB = 1e9;

const nf = (digits: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const nfFixed = (digits: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const DASH = "—";

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return nf(digits).format(n);
}

export function fmtFixed(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return nfFixed(digits).format(n);
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${nfFixed(digits).format(n)} %`;
}

/** Bytes as decimal GB (the unit used everywhere for disk and memory). */
export function toGB(bytes: number): number {
  return bytes / GB;
}

export function fmtGB(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes)) return DASH;
  return `${nfFixed(digits).format(bytes / GB)} GB`;
}

/** Bytes with an automatic unit, for small sizes such as bundles. */
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return DASH;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (Math.abs(v) >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${nf(i === 0 ? 0 : 1).format(v)} ${units[i]}`;
}

export function fmtRate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return DASH;
  return `${fmtBytes(bps)}/s`;
}

export function weiToGlm(wei: string | bigint | null | undefined): number | null {
  if (wei == null || wei === "") return null;
  try {
    return Number(formatUnits(typeof wei === "bigint" ? wei : BigInt(wei), 18));
  } catch {
    return null;
  }
}

export function fmtGlm(glm: number | null | undefined, digits = 4): string {
  if (glm == null || !Number.isFinite(glm)) return DASH;
  return `${nf(digits).format(glm)} GLM`;
}

export function fmtWeiAsGlm(wei: string | null | undefined): string {
  return fmtGlm(weiToGlm(wei), 6);
}

export function blocksToSeconds(blocks: number): number {
  return blocks * BLOCK_SECONDS;
}

/** "2 h 05 m", "45 s", "3 d 4 h". */
export function fmtDuration(totalSec: number | null | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec)) return DASH;
  const s = Math.max(0, Math.round(totalSec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} m`;
  if (m > 0) return `${m} m ${String(sec).padStart(2, "0")} s`;
  return `${sec} s`;
}

export function fmtBlocksAsTime(blocks: number | null | undefined): string {
  if (blocks == null || !Number.isFinite(blocks)) return DASH;
  return fmtDuration(blocksToSeconds(blocks));
}

export function fmtAgo(ts: number | null | undefined, now = Date.now()): string {
  if (ts == null || !Number.isFinite(ts)) return DASH;
  const diff = Math.round((now - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff} s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return DASH;
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function fmtTimeTick(ts: number, spanMs: number): string {
  const d = new Date(ts);
  if (spanMs <= 36 * 3600_000) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function shortHex(hex: string | null | undefined, head = 6, tail = 4): string {
  if (!hex) return DASH;
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
