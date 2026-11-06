import { AlertTriangle, CheckCircle2, CircleDashed, Info, OctagonX } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "ok" | "warn" | "crit" | "info" | "neutral";

export const toneText: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  info: "text-primary",
  neutral: "text-muted",
};
export const toneBg: Record<Tone, string> = {
  ok: "bg-ok/12 border-ok/35",
  warn: "bg-warn/12 border-warn/35",
  crit: "bg-crit/12 border-crit/40",
  info: "bg-primary/12 border-primary/35",
  neutral: "bg-surface-2 border-border",
};
export const toneVar: Record<Tone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  crit: "var(--crit)",
  info: "var(--primary)",
  neutral: "var(--fg-muted)",
};

export function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  const c = cn("size-4 shrink-0", toneText[tone], className);
  switch (tone) {
    case "ok":
      return <CheckCircle2 className={c} aria-hidden />;
    case "warn":
      return <AlertTriangle className={c} aria-hidden />;
    case "crit":
      return <OctagonX className={c} aria-hidden />;
    case "info":
      return <Info className={c} aria-hidden />;
    default:
      return <CircleDashed className={c} aria-hidden />;
  }
}

/** Status is always icon + text + colour (never colour alone). */
export function StatusBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-fg",
        toneBg[tone],
        className,
      )}
    >
      <ToneIcon tone={tone} className="size-3.5" />
      {children}
    </span>
  );
}

export function Badge({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function severityTone(sev: string): Tone {
  if (sev === "ok" || sev === "healthy" || sev === "resolved") return "ok";
  if (sev === "warning" || sev === "degraded") return "warn";
  if (sev === "critical" || sev === "down") return "crit";
  if (sev === "info") return "info";
  return "neutral";
}
