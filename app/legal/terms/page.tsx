import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — AwaazOS",
  description: "Terms governing use of AwaazOS.",
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>Last updated: 23 April 2026</p>

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
        <li>Paid plans are billed via Razorpay according to selected plan terms.</li>
        <li>Applicable taxes (including GST where required) may be charged separately.</li>
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

