import type { ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import type { Range } from "@nodewatch/shared";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { RANGES } from "@/lib/useRange";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-semibold tracking-wide text-fg">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** One filter row above the charts: range switch + live pause/resume (scopes every chart below). */
export function ChartToolbar({
  range,
  onRange,
  paused,
  onPause,
  updatedAt,
  children,
}: {
  range: Range;
  onRange: (r: Range) => void;
  paused?: boolean;
  onPause?: (p: boolean) => void;
  updatedAt?: number;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Segmented label="Time range" value={range} onChange={onRange} options={RANGES.map((r) => ({ value: r, label: r }))} />
      {onPause ? (
        <Button size="sm" onClick={() => onPause(!paused)} aria-pressed={!!paused}>
          {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
          {paused ? "Resume live" : "Pause live"}
        </Button>
      ) : null}
      {updatedAt ? (
        <span className="text-xs text-muted" aria-live="off">
          {paused ? "Paused · " : "Live · "}updated <span className="num">{new Date(updatedAt).toLocaleTimeString("en-GB", { hour12: false })}</span>
        </span>
      ) : null}
      {children}
    </div>
  );
}
