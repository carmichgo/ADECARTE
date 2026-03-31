import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ADECARTE - Transaction Investigation Tool",
  description: "AI-powered forensic transaction analysis",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
