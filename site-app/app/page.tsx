"use client";

import { useCallback, useState } from "react";
import { Preloader } from "@/components/Preloader";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Story } from "@/components/Story";
import { Features } from "@/components/Features";
import { SlowQueries } from "@/components/SlowQueries";
import { Install } from "@/components/Install";
import { Footer } from "@/components/Footer";
import { PulseRule } from "@/components/Pulse";

export default function Home() {
  const [ready, setReady] = useState(false);
  const onDone = useCallback(() => setReady(true), []);
  return (
    <>
      <Preloader onDone={onDone} />
      <Nav ready={ready} />
      <main>
        <Hero ready={ready} />
        <PulseRule />
        <Story />
        <PulseRule />
        <Features />
        <PulseRule />
        <SlowQueries />
        <PulseRule />
        <Install />
      </main>
      <Footer />
    </>
  );
}
