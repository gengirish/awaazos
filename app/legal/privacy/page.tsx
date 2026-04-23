import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — AwaazOS",
  description: "How AwaazOS collects, uses, stores, and protects data.",
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Last updated: 23 April 2026</p>
      <p>
        AwaazOS is built by IntelliForge AI in Hyderabad, India. This policy explains how we collect, use, and
        protect data when you use AwaazOS.
      </p>

      <h2>Data we collect</h2>
      <ul>
        <li>Account data: name, email, hashed password, and role.</li>
        <li>Business data: stall/shop profile, menu items, transactions, receipts, and settings.</li>
        <li>Operational telemetry: voice parse logs, error logs, and performance metrics.</li>
      </ul>

      <h2>How we use data</h2>
      <ul>
        <li>To provide billing, analytics, and receipt delivery features.</li>
        <li>To secure accounts and prevent fraud/abuse.</li>
        <li>To improve speech-to-structure quality and product reliability.</li>
      </ul>

      <h2>PII and model providers</h2>
      <p>
        Customer phone numbers and customer identifying details are not sent to LLM/STT providers unless strictly
        necessary for the selected feature (for example, WhatsApp delivery uses Gupshup).
      </p>

      <h2>Data processors</h2>
      <ul>
        <li>Vercel (hosting)</li>
        <li>Neon (PostgreSQL database)</li>
        <li>Upstash Redis / Fly.io (queues and workers)</li>
        <li>Anthropic and Sarvam (AI/STT processing)</li>
        <li>Razorpay (payments and billing subscriptions)</li>
        <li>Gupshup (WhatsApp receipts)</li>
        <li>Sentry (error monitoring, if enabled)</li>
      </ul>

      <h2>Retention</h2>
      <ul>
        <li>Voice parse logs: up to 90 days.</li>
        <li>Receipts and tax records: up to 7 years for accounting/GST compliance.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can request access, correction, export, or deletion of your personal data through our data-rights endpoint
        or by contacting support.
      </p>

      <h2>Contact</h2>
      <p>
        IntelliForge AI, Hyderabad, India<br />
        Email: contact@intelliforge.tech
      </p>
    </>
  );
}

