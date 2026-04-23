import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DPDP Rights — AwaazOS",
  description: "How AwaazOS supports rights under India’s DPDP Act.",
};

export default function DpdpRightsPage() {
  return (
    <>
      <h1>DPDP Rights (India)</h1>
      <p>Last updated: 23 April 2026</p>
      <p>
        If you are a data principal under India’s Digital Personal Data Protection (DPDP) framework, you can exercise
        your rights with AwaazOS.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>Right to access a summary of your personal data.</li>
        <li>Right to correction and updating of inaccurate data.</li>
        <li>Right to erasure, subject to legal retention obligations.</li>
        <li>Right to grievance redressal through support channels.</li>
      </ul>

      <h2>How to submit a request</h2>
      <ul>
        <li>Authenticated users can call the account deletion endpoint: <code>DELETE /api/me</code>.</li>
        <li>You may also email contact@intelliforge.tech from your registered account email.</li>
      </ul>

      <h2>Processing timelines</h2>
      <p>
        We aim to acknowledge requests within 72 hours and complete standard requests within 30 days, except where
        legal retention or fraud-prevention obligations apply.
      </p>
    </>
  );
}

