const LINKS = [
  ["#metrics", "Metrics"],
  ["#slow-queries", "Slow queries"],
  ["#telegram", "Telegram"],
  ["#pagerduty", "PagerDuty"],
] as const;

/** Fixed, thin. The wordmark, four text links, one button. */
export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-soft/70 bg-paper">
      <nav aria-label="Sections" className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5 sm:px-8">
        <a href="#top" className="font-medium tracking-[-0.01em] text-ink">
          Nodewatch
        </a>
        <ul className="hidden items-center gap-7 md:flex">
          {LINKS.map(([href, label]) => (
            <li key={href}>
              <a href={href} className="inline-flex min-h-11 items-center text-[15px] text-ink transition-colors duration-200 hover:text-action">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <a href="#setup" className="btn-primary !min-h-10 !px-4 text-sm">
          Set up in one click
        </a>
      </nav>
    </header>
  );
}
