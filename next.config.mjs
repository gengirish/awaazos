import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */

// Strict-but-pragmatic CSP. 'unsafe-inline' and 'unsafe-eval' on script-src
// are tolerated for Next.js 14 inline JSON hydration; nonce-based CSP is a
// future hardening (tracked in HARDENING.md → roadmap). Style 'unsafe-inline'
// is required by Tailwind. Connect-src allowlists every upstream we call.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://api.qrserver.com https://*.razorpay.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.anthropic.com https://api.sarvam.ai https://api.razorpay.com https://*.razorpay.com https://api.gupshup.io https://*.sentry.io",
  "frame-src https://api.razorpay.com https://*.razorpay.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://api.razorpay.com",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // We DO need microphone for the POS — explicitly allow self only.
  // browsing-topics is FLoC-style tracking; explicitly disabled.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(self), browsing-topics=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.qrserver.com",
        pathname: "/v1/create-qr-code/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Enabled only when SENTRY_AUTH_TOKEN is set in CI/deploy environment.
  // Local builds without token keep working.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});
