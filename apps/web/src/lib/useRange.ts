import { useSearchParams } from "react-router-dom";
import type { Range } from "@nodewatch/shared";

export const RANGES: Range[] = ["1h", "6h", "24h", "7d", "30d"];
export const RANGE_MS: Record<Range, number> = {
  "1h": 3600_000,
  "6h": 6 * 3600_000,
  "24h": 24 * 3600_000,
  "7d": 7 * 86400_000,
  "30d": 30 * 86400_000,
};

/** Range lives in the URL (?range=6h) so views are deep-linkable. */
export function useRange(fallback: Range = "6h"): [Range, (r: Range) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("range");
  const range = (RANGES as string[]).includes(raw ?? "") ? (raw as Range) : fallback;
  const set = (r: Range) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("range", r);
        return n;
      },
      { replace: true },
    );
  return [range, set];
}
