import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Manrope, Space_Grotesk } from "next/font/google";

import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Luna | Lumni",
  description: "Assistente virtual da Lumni para qualificar contatos e tirar duvidas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className={`${manrope.variable} ${spaceGrotesk.variable}`}>
        <Analytics />
        {children}
      </body>
    </html>
  );
}
