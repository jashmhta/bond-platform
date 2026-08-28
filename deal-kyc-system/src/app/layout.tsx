import type { Metadata } from "next";
import { Outfit, Geist_Mono } from "next/font/google";
import { SiteNav, SiteFooter } from "@/components/chrome";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-brand", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "BinaryBonds — KYC & Deal Confirmation",
  description:
    "Client KYC onboarding and Buy/Sell deal confirmation via BinaryBonds — TS/TB reference numbering, BSE Clearing Agent settlement letterhead PDFs.",
  icons: { icon: "/logo.png" },
  openGraph: {
    title: "BinaryBonds — KYC & Deal Confirmation",
    description: "Onboard once. Confirm in seconds.",
    images: [{ url: "/logo.png", width: 512, height: 512, alt: "Binary Bonds logo" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <SiteNav />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
