"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Pulse } from "./Pulse";
import { EASE } from "@/lib/motion";

const LINKS = [
  { href: "#why", label: "How it works" },
  { href: "#install", label: "Install" },
];

export function Nav({ ready }: { ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 24);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);

  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={ready ? { y: 0, opacity: 1 } : {}}
      transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${solid ? "bg-ground/80 backdrop-blur-md" : ""}`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-3" aria-label="Nodewatch, back to top">
          <Pulse width={54} />
          <span className="font-mono text-sm tracking-[0.18em] text-ink">NODEWATCH</span>
        </a>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Sections">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="group relative text-sm text-ink-muted transition-colors hover:text-ink">
              {l.label}
              <span className="absolute inset-x-0 -bottom-1 h-px origin-left scale-x-0 bg-signal transition-transform duration-300 ease-out group-hover:scale-x-100" aria-hidden="true" />
            </a>
          ))}
          <a href="https://github.com/rishabh-onerx/nodewatch" target="_blank" rel="noreferrer noopener" className="rounded-full border border-line px-4 py-1.5 text-sm text-ink transition-colors hover:border-signal/60">
            GitHub
          </a>
        </nav>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          className="grid size-11 place-items-center rounded-full md:hidden"
        >
          <span className="relative block h-3 w-5">
            <span className={`absolute inset-x-0 top-0 h-px bg-ink transition-transform duration-300 ${open ? "translate-y-[6px] rotate-45" : ""}`} />
            <span className={`absolute inset-x-0 bottom-0 h-px bg-ink transition-transform duration-300 ${open ? "-translate-y-[6px] -rotate-45" : ""}`} />
          </span>
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            id="mobile-nav"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="overflow-hidden border-t border-line bg-ground/95 backdrop-blur-md md:hidden"
            aria-label="Sections"
          >
            <ul className="flex flex-col px-5 py-3">
              {[...LINKS, { href: "https://github.com/rishabh-onerx/nodewatch", label: "GitHub" }].map((l, i) => (
                <motion.li key={l.href} initial={{ x: -8, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.05 * i, duration: 0.3, ease: EASE }}>
                  <a href={l.href} onClick={() => setOpen(false)} className="block min-h-12 py-3 text-lg text-ink">
                    {l.label}
                  </a>
                </motion.li>
              ))}
            </ul>
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
