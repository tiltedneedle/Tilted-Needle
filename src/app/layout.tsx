import type { Metadata } from "next";
import "./globals.css";

// Deliberately no next/font for the type family: it fetches from
// fonts.gstatic.com at BUILD time, which fails the whole build on a
// restricted network. A runtime <link> degrades instead of breaking --
// worst case the system fallback stack in globals.css renders, the build
// never fails on it.

export const metadata: Metadata = {
  title: "Tilted Needle",
  description: "Time tracking and video performance attribution",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
