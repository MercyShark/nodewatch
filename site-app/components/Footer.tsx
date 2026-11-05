export function Footer() {
  return (
    <footer className="border-t border-soft bg-paper">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-8 sm:px-8">
        <span className="font-medium text-ink">Nodewatch</span>
        <p className="text-sm text-ink/70">Node metrics, slow queries, Telegram, PagerDuty.</p>
      </div>
    </footer>
  );
}
