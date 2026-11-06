import { Logo } from "./Logo";
import { IMAGE_PAGE } from "@/lib/site";

export function Footer() {
  return (
    <footer className="border-t border-navy/15">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 sm:px-8">
        <Logo />
        <p className="text-sm text-navy/80">Built for Arkiv node operators · ETHGlobal Mumbai 2026</p>
        <nav aria-label="Links" className="flex gap-5 text-sm font-medium">
          <a className="text-navy/80 underline-offset-4 hover:text-navy hover:underline" href={IMAGE_PAGE} target="_blank" rel="noreferrer noopener">
            Docker Hub
          </a>
          <a className="text-navy/80 underline-offset-4 hover:text-navy hover:underline" href="https://arkiv.network" target="_blank" rel="noreferrer noopener">
            Arkiv
          </a>
        </nav>
      </div>
    </footer>
  );
}
