import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  dash?: string;
  kind?: "line" | "rect";
  value?: ReactNode;
}

/** HTML legend above the plot; clicking toggles a series (when onToggle is set). */
export function ChartLegend({
  items,
  hidden,
  onToggle,
  className,
}: {
  items: LegendItem[];
  hidden?: Set<string>;
  onToggle?: (key: string) => void;
  className?: string;
}) {
  return (
    <ul className={cn("mb-2 flex flex-wrap gap-x-1 gap-y-1", className)} aria-label="Legend">
      {items.map((it) => {
        const off = hidden?.has(it.key);
        const swatch =
          it.kind === "rect" ? (
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: it.color }} aria-hidden />
          ) : (
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line x1="1" y1="4" x2="17" y2="4" stroke={it.color} strokeWidth="2" strokeDasharray={it.dash || undefined} strokeLinecap="round" />
            </svg>
          );
        const inner = (
          <>
            {swatch}
            <span className={cn("text-xs", off ? "text-muted line-through" : "text-fg")}>{it.label}</span>
            {it.value != null ? <span className="num text-xs text-muted">{it.value}</span> : null}
          </>
        );
        return (
          <li key={it.key}>
            {onToggle ? (
              <button
                type="button"
                aria-pressed={!off}
                onClick={() => onToggle(it.key)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 hover:bg-surface-2"
              >
                {inner}
              </button>
            ) : (
              <span className="inline-flex min-h-8 items-center gap-1.5 px-1.5">{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AxisCaption({ y, x }: { y?: string; x?: string }) {
  return (
    <div className="pointer-events-none flex justify-between text-[11px] text-muted">
      <span>{y}</span>
      <span>{x}</span>
    </div>
  );
}

/** Tooltip body: value first (strong), series name secondary, line key. */
export function TooltipBox({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; value: string; color: string; dash?: string }[];
}) {
  return (
    <div className="min-w-40 rounded-lg border border-border bg-surface-2 px-3 py-2 shadow-xl shadow-black/40">
      <p className="num mb-1 text-xs text-muted">{title}</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <svg width="12" height="6" aria-hidden className="shrink-0">
              <line x1="0" y1="3" x2="12" y2="3" stroke={r.color} strokeWidth="2" strokeDasharray={r.dash || undefined} />
            </svg>
            <span className="num text-sm font-semibold text-fg">{r.value}</span>
            <span className="truncate text-xs text-muted">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
