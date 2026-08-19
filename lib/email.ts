/**
 * Transactional email — currently used only for password-reset links.
 *
 * AwaazOS has no email provider wired yet (no Resend / SES / Nodemailer in
 * package.json). This module is the seam: it is called on the happy path of
 * the reset flow and deliberately **never throws and never blocks**, so the
 * absence of a provider cannot be detected through error paths or timing.
 *
 * To go live, implement `deliver()` against a provider and set the env vars
 * it needs. Everything else in the flow already works.
 *
 * NEVER log the reset URL or token. An operator who must recover a vendor
 * out-of-band should mint a fresh token rather than read one out of logs.
 */

import { logger } from "@/lib/logger";

export type SendPasswordResetEmailInput = {
  to: string;
  name: string | null;
  url: string;
  expiresAt: Date;
};

/** Privacy-safe shape for logs: keeps the first initial and full domain. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "[redacted]";
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Best-effort send. Always resolves `{ ok: true }` regardless of whether the
 * message actually went out — the caller must not be able to distinguish
 * "sent" from "no provider configured" from "provider rejected it".
 */
export async function sendPasswordResetEmail(
  input: SendPasswordResetEmailInput,
): Promise<{ ok: true }> {
  const { to, expiresAt } = input;

  // No provider configured — the flow still issues a valid token, it simply
  // has no delivery channel. Logged (masked) so ops can see demand for it.
  logger.warn(
    {
      toMasked: maskEmail(to),
      expiresAt: expiresAt.toISOString(),
      reason: "no email provider configured",
    },
    "email.password_reset.unconfigured",
  );

  return { ok: true };
}
