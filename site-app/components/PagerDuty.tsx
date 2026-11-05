import { Siren } from "lucide-react";

/** One incident row, as PagerDuty shows it. Critical rules trigger it and resolve it when the condition clears. */
export function PagerDuty() {
  return (
    <div className="r-one border border-soft bg-paper">
      <div className="hidden grid-cols-[auto_1fr_8rem_6rem] gap-x-6 border-b border-soft px-5 py-3 text-xs tracking-[0.08em] text-ink/70 sm:grid">
        <span className="w-20">Status</span>
        <span>Summary</span>
        <span>Service</span>
        <span>Urgency</span>
      </div>
      <div className="grid grid-cols-1 gap-y-3 px-4 py-4 sm:grid-cols-[auto_1fr_8rem_6rem] sm:items-center sm:gap-x-6 sm:px-5">
        <span className="inline-flex w-20 items-center gap-1.5 font-medium text-down">
          <Siren className="size-4" strokeWidth={1.5} aria-hidden />
          Down
        </span>
        <div className="min-w-0">
          <p className="text-ink">
            <span className="font-medium">ContainerDown</span> on sgp-01: execution exited with code <span className="font-mono">137</span>.
          </p>
          <p className="font-mono mt-1 text-xs text-ink/70">
            #P3K8Q2 · dedup nodewatch:ContainerDown:sgp-01 · opened 14:31
          </p>
        </div>
        <span className="text-ink/80">
          <span className="eyebrow sm:hidden">Service · </span>Arkiv node
        </span>
        <span className="text-ink/80">
          <span className="eyebrow sm:hidden">Urgency · </span>High
        </span>
      </div>
    </div>
  );
}
