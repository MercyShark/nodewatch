import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Section } from "@/components/Section";
import { Matrix } from "@/components/Matrix";
import { SlowQueries } from "@/components/SlowQueries";
import { Telegram } from "@/components/Telegram";
import { PagerDuty } from "@/components/PagerDuty";
import { Setup } from "@/components/Setup";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-16 focus:left-4 focus:z-50 focus:bg-paper focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Section
          id="metrics"
          eyebrow="Node metrics · example fleet"
          title="Every node you run, in one matrix."
          lead="Name, network, head lag, peers, sync and a one-word status. Head lag is measured against the public network head, so a quiet node and a stuck node look different."
          wash
        >
          <Matrix />
        </Section>
        <Section
          id="slow-queries"
          eyebrow="Slow query finder · sample shapes"
          title="The queries that are actually slow."
          lead="Nodewatch runs each query shape against your own node as the dataset grows and keeps the ones that cross the line. Statement, p95 and how often it ran. No chart gallery."
        >
          <SlowQueries />
        </Section>
        <Section
          id="telegram"
          eyebrow="Telegram alerts"
          title="A message when it matters."
          lead="The bot writes when a node falls behind, a query crosses its line, or a container stops. Each message carries the verdict and the fix."
          wash
        >
          <Telegram />
        </Section>
        <Section
          id="pagerduty"
          eyebrow="PagerDuty"
          title="Critical incidents, opened and closed for you."
          lead="The same critical events open a PagerDuty incident with service, urgency and a short summary. When the node recovers, Nodewatch resolves it."
        >
          <PagerDuty />
        </Section>
        <Setup />
      </main>
      <Footer />
    </>
  );
}
