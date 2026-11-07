import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { LiveDemo } from "@/components/LiveDemo";
import { Features } from "@/components/Features";
import { Install } from "@/components/Install";
import { Footer } from "@/components/Footer";
import { LoaderGate } from "@/components/LoaderGate";

export default function Home() {
  return (
    <LoaderGate>
      <a href="#features" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-navy focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Nav />
      <main>
        <Hero />
        <LiveDemo />
        <Features />
        <Install />
      </main>
      <Footer />
    </LoaderGate>
  );
}
