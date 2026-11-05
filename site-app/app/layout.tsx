import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SmoothScroll } from "@/components/SmoothScroll";

export const metadata: Metadata = {
  title: "Nodewatch",
  description:
    "The operations console that runs next to your Arkiv node. One command to install, one wallet to open it. Verdicts with the fix, a disk forecast, a heartbeat on the chain, and a slow-query finder.",
  openGraph: {
    title: "Nodewatch",
    description: "Why is my Arkiv node out of rotation? Nodewatch tells you, and what to type to fix it.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#060a14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
