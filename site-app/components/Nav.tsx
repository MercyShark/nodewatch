"use client";

import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";

/** Thin bar: wordmark, two anchors, one action. Gains a backdrop once the page scrolls. */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("fixed inset-x-0 top-0 z-40 transition-colors duration-300", scrolled && "border-b border-navy/10 bg-dusk/85 backdrop-blur-md")}>
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <a href="#top" aria-label="Nodewatch, back to top">
          <Logo />
        </a>
        <div className="flex items-center gap-2 sm:gap-6">
          <a href="#demo" className="hidden min-h-11 items-center text-[15px] font-medium text-navy/80 transition-colors hover:text-navy sm:inline-flex">
            Live demo
          </a>
          <a href="#features" className="hidden min-h-11 items-center text-[15px] font-medium text-navy/80 transition-colors hover:text-navy sm:inline-flex">
            Features
          </a>
          <a href="#install" className="hidden min-h-11 items-center text-[15px] font-medium text-navy/80 transition-colors hover:text-navy sm:inline-flex">
            Install
          </a>
          <a
            href="#install"
            className="inline-flex min-h-10 items-center rounded-full bg-navy px-4 text-sm font-medium text-white transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0"
          >
            Get started
          </a>
        </div>
      </nav>
    </header>
  );
}
