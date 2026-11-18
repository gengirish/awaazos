import type { Metadata } from "next";
import Link from "next/link";

import { BUSINESS_NAME, BusinessDetails } from "@/components/legal/BusinessDetails";
import { BRAND_FORMER_NAME, BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Privacy Policy — ${BRAND_NAME}`,
  description: `How ${BRAND_NAME} collects, uses, stores, and protects data.`,
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Last updated: 13 November 2026</p>
      <p>
        {BRAND_NAME} (formerly {BRAND_FORMER_NAME}) is built and run by {BUSINESS_NAME} (IntelliForge AI), a proprietorship in Hyderabad, India. This
        policy explains how we collect, use, and protect data when you use {BRAND_NAME}, whether you sell with it or buy
        from a store that runs on it.
      </p>

      <h2>Data we collect</h2>
      <h3>Sellers and their staff</h3>
      <ul>
        <li>Account data: name, email, phone number, hashed password, and role.</li>
        <li>
          Business data: store profile and photos, menu or product list, pre-orders, offers, transactions, receipts, and
          settings, including the store&apos;s UPI ID and, if connected, its Razorpay account (keys are stored
          encrypted).
        </li>
        <li>Billing data: your {BRAND_NAME} plan and Razorpay subscription and payment references.</li>
        <li>Answers you give in the owner survey.</li>
        <li>Phone alerts: if you turn them on, a push subscription for that device.</li>
      </ul>
      <h3>Buyers ordering from a store</h3>
      <ul>
        <li>The name, phone number and, for delivery, address you enter at checkout.</li>
        <li>Your email, if you sign in to keep your details and see your orders.</li>
        <li>
          Payment details you give the seller: a UPI reference number and, if you attach one, a payment screenshot.
          The screenshot is kept privately, shown only to the seller&apos;s staff, and deleted once the seller marks
          the order paid, rejects the payment, or cancels the order.
        </li>
        <li>Any rating and comment you leave on an order.</li>
      </ul>
      <h3>Everyone</h3>
      <ul>
        <li>
          Operational data: voice parse logs (the transcript of a voice order and how it was understood, never the
          audio), error logs, and performance metrics. IP addresses are used to limit abuse and are not stored with your orders.
        </li>
        <li>
          Cookies and device storage: sign-in cookies, and on your device only, your cart, recent orders and
          preferences such as sound and cookie choice.
        </li>
      </ul>
      <p>
        We also keep the business name and public contact details of home businesses we approach about {BRAND_NAME}, and
        anonymous answers to our public seller survey.
      </p>

      <h2>How we use data</h2>
      <ul>
        <li>To run the service: billing, orders, payments, receipts, alerts, and analytics for the seller.</li>
        <li>To send the emails you need: sign-in links, password resets, and billing notices.</li>
        <li>
          To contact sellers about their store: to help, and to ask how {BRAND_NAME} is working for them. We quote a seller
          on our website only after they agree in writing.
        </li>
        <li>To secure accounts and prevent fraud and abuse.</li>
        <li>To improve speech recognition, order understanding, and product reliability.</li>
      </ul>

      <h2>Buyers&apos; data and sellers</h2>
      <p>
        When you order from a store, the seller sees the details you give at checkout so they can prepare, deliver,
        and settle your order. They may contact you, for example on WhatsApp, about that order. How a seller uses
        your details outside {BRAND_NAME} is up to that seller. A seller never sees another store&apos;s customers.
      </p>

      <h2>PII and model providers</h2>
      <p>
        Customer phone numbers, names, addresses, and payment references are never sent to AI or speech-to-text
        providers. Speech-to-text receives only the audio and its language; order understanding receives only the
        transcript and the menu. Audio is not stored. For English and Hindi, speech is usually recognised by your
        browser&apos;s own speech service (Google&apos;s, in Chrome), under that browser&apos;s terms.
        Phone alerts carry the bill number, amount, and item count, never the buyer&apos;s name or contact details.
      </p>

      <h2>Data processors</h2>
      <ul>
        <li>Vercel (hosting, and storage for store and product photos and, privately, payment screenshots)</li>
        <li>Neon (PostgreSQL database)</li>
        <li>Upstash Redis / Fly.io (rate limits, queues, and workers)</li>
        <li>
          Anthropic, Sarvam, OpenAI, and (when enabled) Groq for AI / speech-to-text
          processing. For OpenAI, we operate under a Zero-Data-Retention agreement: voice
          clips are processed in-memory and discarded immediately, not stored or used for
          model training. Groq is invoked only as a fallback when the primary provider is
          unavailable.
        </li>
        <li>fal (AI images, when a seller asks for one; only the seller&apos;s description is sent)</li>
        <li>
          Razorpay ({BRAND_NAME} subscriptions; and, for sellers who connect their own Razorpay account, the buyer&apos;s
          online payment to that seller)
        </li>
        <li>AgentMail (email delivery)</li>
        <li>Browser push services from Google, Apple, and Mozilla (phone alerts, for devices that turn them on)</li>
        <li>Sentry (error monitoring, if enabled)</li>
      </ul>

      <h2>Retention</h2>
      <ul>
        <li>Voice parse logs: up to 90 days.</li>
        <li>Receipts and tax records: up to 7 years for accounting/GST compliance.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can request access, correction, export, or deletion of your personal data by contacting support. See{" "}
        <Link href="/legal/dpdp-rights">DPDP Rights</Link> for how.
      </p>

      <h2>Contact</h2>
      <BusinessDetails />
    </>
  );
}
