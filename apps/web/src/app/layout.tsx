import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Sans, Sora } from "next/font/google";
import "./globals.css";

const displayFont = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const bodyFont = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MileShop | Catálogo",
  description: "Explora el catálogo de productos de MileShop.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="es" className={`h-full antialiased ${displayFont.variable} ${bodyFont.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
