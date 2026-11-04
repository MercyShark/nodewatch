import { AlertCircle, Inbox, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/api";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("nw-skeleton rounded-md", className)} aria-hidden />;
}

export function LoadingBlock({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("flex flex-col gap-3", className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-full min-h-24 w-full flex-1" />
    </div>
  );
}

export function EmptyState({
  title,
  children,
  icon,
  className,
  action,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-4 py-8 text-center", className)}>
      <span className="text-muted [&>svg]:size-6" aria-hidden>
        {icon ?? <Inbox />}
      </span>
      <p className="text-sm font-medium text-fg">{title}</p>
      {children ? <p className="max-w-md text-sm text-muted">{children}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
  title = "Could not load this data",
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 px-4 py-8 text-center", className)}>
      <AlertCircle className="size-6 text-[#f87171]" aria-hidden />
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="max-w-md text-sm text-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry} className="mt-1">
          <RotateCw className="size-4" aria-hidden /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function InlineError({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={cn("flex items-start gap-2 text-sm text-[#fca5a5]", className)}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{typeof error === "string" ? error : errorMessage(error)}</span>
    </p>
  );
}
