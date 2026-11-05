import type { ReactNode } from "react";

/** One section: eyebrow, display title, one line of support, then the fragment. All four share this left edge and width. */
export function Section({
  id,
  eyebrow,
  title,
  lead,
  wash = false,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  wash?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-14 py-20 sm:py-28 ${wash ? "bg-mist" : "bg-paper"}`}>
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="font-display mt-3 text-[clamp(1.9rem,4vw,2.75rem)] text-ink">{title}</h2>
        <p className="measure mt-4 text-ink/80">{lead}</p>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}
