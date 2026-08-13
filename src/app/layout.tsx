import type { Metadata } from "next";
import "./globals.css";
import ThemeScript from "@/components/ThemeScript";

// Deliberately no next/font for the type family: it fetches from
// fonts.gstatic.com at BUILD time, which fails the whole build on a
// restricted network. A runtime <link> degrades instead of breaking --
// worst case the system fallback stack in globals.css renders, the build
// never fails on it.

export const metadata: Metadata = {
  title: {
    default: "Tilted Needle",
    template: "%s · Tilted Needle",
  },
  description: "Time tracking and video performance attribution",
  // An internal tool: nothing here should ever appear in a search engine,
  // including the login page.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          Two families, each doing one job.

          Inter for the interface: it is drawn for screens at small sizes,
          its numerals line up, and it is neutral enough to disappear --
          which is the point. Plus Jakarta Sans has rounder, friendlier
          shapes that read as "startup product" rather than as an instrument.

          Instrument Serif for display numerals ONLY -- the four figures at
          the top of a dashboard and nothing else. A serif against a neutral
          sans is the oldest trick in editorial design and still the cheapest
          way to make a number look considered rather than merely large. Used
          anywhere else it would read as decoration, which is the failure
          mode this brief is most at risk of.

          One request for both, and still a runtime <link> rather than
          next/font, for the build reason above.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
        <ThemeScript />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
