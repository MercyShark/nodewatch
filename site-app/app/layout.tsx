import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nodewatch: your Arkiv node, watched",
  description:
    "Running a node is easy. Keeping it healthy is not. Nodewatch watches your Arkiv node, alerts Telegram and PagerDuty, and restarts failed containers in one click. One docker run.",
  openGraph: {
    title: "Nodewatch",
    description: "Your Arkiv node, watched. Metrics, slow queries, Telegram and PagerDuty alerts, one-click fixes.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#8fb4e3", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&family=Ubuntu+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
