"use client";

import { Reveal } from "./Reveal";
import { Magnetic } from "./Magnetic";

/** Closing: what you need, in one line, and where to go next. The command itself is in the hero. */
export function Install() {
  return (
    <section id="install" className="mx-auto max-w-3xl px-5 text-center sm:px-8">
      <Reveal>
        <h2 data-reveal className="font-display text-4xl leading-tight text-ink sm:text-5xl" style={{ textWrap: "balance" }}>
          Four minutes to install.
        </h2>
        <p data-reveal className="mx-auto mt-4 max-w-md text-ink-muted">
          Needs a host that already runs the Arkiv node kit, Docker, and the wallet you will sign in with. Only that wallet can open it.
        </p>
        <div data-reveal className="mt-8 flex flex-wrap justify-center gap-3">
          <Magnetic href="#top" className="bg-signal text-ground hover:bg-[#7fdcff]">
            Copy the command
          </Magnetic>
          <Magnetic href="https://github.com/rishabh-onerx/nodewatch/blob/main/site/index.html" className="border border-line text-ink hover:border-signal/60" strength={0.25}>
            Setup guide
          </Magnetic>
        </div>
      </Reveal>
    </section>
  );
}
