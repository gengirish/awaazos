import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import { CookieConsentBanner } from "@/components/legal/CookieConsentBanner";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import "./globals.css";

const baloo = Baloo_2({
  subsets: ["latin", "latin-ext"],
  variable: "--font-baloo",
  display: "swap",
});

const nunito = Nunito({
  subsets: ["latin", "latin-ext"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AwaazOS — Bol. Bill. Becho.",
  description: "Voice-first POS and UPI billing for Indian vendors.",
  // iPhone: Home Screen install is what unlocks web push (iOS 16.4+).
  appleWebApp: { capable: true, title: "AwaazOS", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#FF6600",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <body className={`${baloo.variable} ${nunito.variable} min-h-screen font-body antialiased`}>
        <Providers>
          {children}
          <CookieConsentBanner />
          <Toaster richColors position="top-center" />
        </Providers>
      </body>
    </html>
  );
}
