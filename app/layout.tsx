import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bot Office",
  description: "Live desks for Shahriar's assistant bots",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
