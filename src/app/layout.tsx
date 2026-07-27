import type { Metadata } from "next";
import "./globals.css";

// Deliberately no next/font: it fetches from fonts.gstatic.com at build time,
// which fails on restricted networks. globals.css uses a system font stack.

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
    <html lang="en" data-theme="dark" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
