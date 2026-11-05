import { Pulse } from "./Pulse";

export function Footer() {
  return (
    <footer className="mx-auto mt-32 max-w-6xl border-t border-line px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <Pulse width={54} />
          <span className="font-mono text-sm tracking-[0.18em] text-ink">NODEWATCH</span>
        </div>
        <p className="text-sm text-ink-muted">ETHGlobal Mumbai 2026 · Apache-2.0</p>
        <nav className="flex gap-6 text-sm" aria-label="Links">
          <a className="text-ink-muted transition-colors hover:text-ink" href="https://github.com/rishabh-onerx/nodewatch" target="_blank" rel="noreferrer noopener">GitHub</a>
          <a className="text-ink-muted transition-colors hover:text-ink" href="https://nodes.arkiv.network" target="_blank" rel="noreferrer noopener">nodes.arkiv.network</a>
          <a className="text-ink-muted transition-colors hover:text-ink" href="https://arkiv.network" target="_blank" rel="noreferrer noopener">Arkiv</a>
        </nav>
      </div>
    </footer>
  );
}
