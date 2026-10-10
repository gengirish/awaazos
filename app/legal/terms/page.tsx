import type { Metadata } from "next";

import { TRIAL_DAYS } from "@/lib/constants";
import { PLAN_MARKETING } from "@/lib/plan-copy";

export const metadata: Metadata = {
  title: "Terms of Service — AwaazOS",
  description: "Terms governing use of AwaazOS.",
};

const starter = PLAN_MARKETING.STARTER;

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>Last updated: 10 October 2026</p>

      <h2>Acceptance</h2>
      <p>By using AwaazOS, you agree to these Terms.</p>

      <h2>Account responsibilities</h2>
      <ul>
        <li>You are responsible for all activity under your account.</li>
        <li>You must keep login credentials secure and notify us of unauthorized access.</li>
      </ul>

      <h2>Allowed use</h2>
      <ul>
        <li>Use AwaazOS only for lawful commercial activities.</li>
        <li>No abuse of API routes, no credential stuffing, no reverse engineering attempts.</li>
      </ul>

      <h2>Billing and subscriptions</h2>
      <ul>
        <li>
          New accounts get a {TRIAL_DAYS}-day free trial with every feature of the {starter.label} plan. No card is
          needed to start it.
        </li>
        <li>
          After the trial, creating new bills and taking new orders needs a paid subscription: {starter.price} or{" "}
          {starter.yearlyPrice}. Without one, your existing bills, reports and settings stay available to view and
          export, and orders already placed can still be completed.
        </li>
        <li>
          Prices exclude GST. GST at 18% is added to every charge and shown before you pay.
        </li>
        <li>
          Subscriptions are billed in advance through Razorpay and renew automatically each month or year until
          cancelled. If you subscribe during the trial, the first charge is made when the trial ends.
        </li>
        <li>
          You can cancel anytime from Billing settings. Your plan stays active until the end of the period you have
          paid for and does not renew.
        </li>
        <li>
          If a renewal payment fails, Razorpay retries it. Your plan stays active for a short grace period, after
          which the paid features stop until payment succeeds.
        </li>
        <li>
          Accounts created before the free trial was introduced keep their free plan and its monthly bill limit.
        </li>
      </ul>

      <h2>Service availability</h2>
      <p>
        We target high availability but do not guarantee uninterrupted service. Planned maintenance and third-party
        provider outages may affect availability.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, AwaazOS is provided on an “as is” basis and IntelliForge AI is not
        liable for indirect, incidental, or consequential damages.
      </p>

      <h2>Termination</h2>
      <p>We may suspend or terminate accounts for material violations of these Terms or unlawful activity.</p>

      <h2>Governing law</h2>
      <p>These Terms are governed by the laws of India. Jurisdiction: Hyderabad, Telangana.</p>
    </>
  );
}

