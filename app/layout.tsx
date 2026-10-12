import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import { CookieConsentBanner } from "@/components/legal/CookieConsentBanner";
import { COOKIE_PREF_BOOT_SCRIPT } from "@/lib/cookie-pref";
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
  // Without `cover`, env(safe-area-inset-*) is 0 on iPhones. The body and the
  // fixed bars pad themselves back inside the safe area (app/globals.css).
  viewportFit: "cover",
};

/**
 * Everything here ships to every page, including the public storefront a buyer
 * opens on mobile data — keep client code out of it:
 *  - no `SessionProvider`: nothing calls `useSession()`, and it fetched
 *    /api/auth/session on every page load and tab focus;
 *  - no `<Toaster />`: only the signed-in app raises toasts, so it lives in
 *    app/(vendor)/layout.tsx and app/(print)/layout.tsx. A toast fired from a
 *    page outside those groups will not show until its layout renders one.
 * scripts/check-bundle-budget.mjs fails CI when first-load JS grows.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        {/* Static string, see lib/cookie-pref.ts. Must run before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: COOKIE_PREF_BOOT_SCRIPT }} />
      </head>
      <body className={`${baloo.variable} ${nunito.variable} min-h-screen font-body antialiased`}>
        {children}
        <CookieConsentBanner />
      </body>
    </html>
  );
}
