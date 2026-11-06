// Bento grid by Magic UI (Dillion Verma), MIT, listed on 21st.dev (bento grids): https://magicui.design/r/bento-grid.json
// Adapted: no shadcn Button or Radix icons (no links on these cards), Nodewatch palette, a visual slot on top.
import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BentoGridProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
}

interface BentoCardProps extends ComponentPropsWithoutRef<"article"> {
  name: string;
  description: string;
  Icon: ElementType;
  visual: ReactNode;
  tag?: string;
}

export function BentoGrid({ children, className, ...props }: BentoGridProps) {
  return (
    <div className={cn("grid w-full auto-rows-[minmax(20rem,auto)] grid-cols-1 gap-4 md:grid-cols-3", className)} {...props}>
      {children}
    </div>
  );
}

export function BentoCard({ name, description, Icon, visual, tag, className, ...props }: BentoCardProps) {
  return (
    <article
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-[28px] border border-navy/15 bg-card",
        "transition-[transform,border-color,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:border-navy/35",
        "hover:shadow-[0_24px_60px_-30px_rgba(13,26,51,0.45)] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    >
      <div className="relative min-h-40 flex-1 overflow-hidden p-5 pb-0">{visual}</div>
      <div className="relative z-10 flex flex-col gap-1.5 p-6 pt-5">
        {tag ? <span className="w-fit rounded-full border border-navy/25 px-2.5 py-0.5 font-mono text-[11px] tracking-wide whitespace-nowrap text-navy/80">{tag}</span> : null}
        <div className="flex items-center gap-2.5">
          <span className="inline-grid size-9 shrink-0 place-items-center rounded-xl bg-navy text-dusk">
            <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h3 className="text-xl font-bold tracking-[-0.01em] text-navy">{name}</h3>
        </div>
        <p className="max-w-lg text-[15px] leading-relaxed text-navy/80">{description}</p>
      </div>
    </article>
  );
}
