const PROOF = [
  ["Nodes watched", "4"],
  ["Slowest query", "412 ms"],
  ["Open incidents", "1"],
] as const;

export function Hero() {
  return (
    <section id="top" className="pt-36 pb-16 sm:pt-44 sm:pb-20">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <h1 className="font-display max-w-[14ch] text-[clamp(2.5rem,6.5vw,4.75rem)] text-ink" style={{ textWrap: "balance" }}>
          Know why your node is out of rotation.
        </h1>
        <p className="measure mt-6 text-lg text-ink/80">
          Nodewatch runs next to your Arkiv node. It shows the metrics that matter, finds the queries that are slow, and alerts you on Telegram and PagerDuty.
        </p>
        <div className="mt-8">
          <a href="#setup" className="btn-primary">
            Set up in one click
          </a>
        </div>

        <dl className="mt-16 grid grid-cols-1 gap-y-6 border-t border-soft pt-6 sm:grid-cols-3 sm:gap-x-8">
          {PROOF.map(([k, v]) => (
            <div key={k}>
              <dt className="eyebrow">{k}</dt>
              <dd className="font-mono mt-1 text-2xl text-action">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
