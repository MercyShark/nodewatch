/** The mark: a single heartbeat trace in a navy tile. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0d1a33" />
        <path d="M4 17h6l3-8 5 15 3-7h7" fill="none" stroke="#8fb4e3" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-lg font-bold tracking-[-0.02em] text-navy">Nodewatch</span>
    </span>
  );
}
