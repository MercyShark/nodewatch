import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("min-w-0 rounded-xl border border-border bg-surface", className)} {...rest} />;
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
  id,
  level = 2,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  id?: string;
  level?: 2 | 3;
  className?: string;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5", className)}>
      <div className="min-w-0 flex-[1_1_16rem]">
        <H id={id} className="flex items-center gap-2 text-base font-semibold text-fg">
          {icon ? <span className="text-muted [&>svg]:size-4" aria-hidden>{icon}</span> : null}
          {title}
        </H>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pt-3 pb-4 sm:px-5 sm:pb-5", className)} {...rest} />;
}
