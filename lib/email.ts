/**
 * Transactional email — currently used only for password-reset links.
 *
 * Sends through AgentMail's REST API over plain `fetch`, so this module adds
 * no dependency. Swapping provider (Resend, SES, Postmark) means rewriting
 * `deliver()` and nothing else.
 *
 * Two invariants this file must never break, both load-bearing for the
 * security of the reset flow in app/api/auth/forgot-password/route.ts:
 *
 *   1. It never throws. The caller returns an identical `{ ok: true }` whether
 *      or not the account exists, so an exception here would leak account
 *      existence through the error path.
 *   2. It never logs the reset URL or token. An operator recovering a vendor
 *      out-of-band must mint a fresh token, not read one out of logs.
 */

import { logger } from "@/lib/logger";

export type SendPasswordResetEmailInput = {
  to: string;
  name: string | null;
  url: string;
  expiresAt: Date;
};

const AGENTMAIL_API_BASE = process.env.AGENTMAIL_API_BASE ?? "https://api.agentmail.to/v0";
const SEND_TIMEOUT_MS = 10_000;

type MailConfig = { apiKey: string; inboxId: string };

function getConfig(): MailConfig | null {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  const inboxId = process.env.AGENTMAIL_INBOX_ID;
  if (!apiKey || !inboxId) return null;
  return { apiKey, inboxId };
}

/** Privacy-safe shape for logs: first initial plus full domain. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "[redacted]";
  return `${local.slice(0, 1)}***@${domain}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildText(greetingName: string, url: string): string {
  return [
    `Namaste ${greetingName},`,
    "",
    "We received a request to reset your AwaazOS password.",
    "This link works once and expires in 30 minutes:",
    "",
    url,
    "",
    "If you didn't ask for this, you can ignore this email — your password will not change.",
    "",
    "AwaazOS — Bol. Bill. Becho.",
  ].join("\n");
}

function buildHtml(greetingName: string, url: string): string {
  // Inline attribute styling only — no <style> block, since many inboxes
  // strip them.
  return `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;margin:0;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;">
    <div style="font-weight:700;font-size:18px;color:#FF6B00;">AwaazOS</div>
    <h1 style="font-size:22px;margin:24px 0 8px 0;color:#1a1a1a;">Reset your password</h1>
    <p style="color:#334155;line-height:1.5;">
      Namaste ${escapeHtml(greetingName)},<br><br>
      We received a request to reset your AwaazOS password.
      This link works once and expires in 30 minutes.
    </p>
    <p style="margin:28px 0;">
      <a href="${url}" style="background:#FF6B00;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Reset password
      </a>
    </p>
    <p style="color:#64748b;font-size:12px;line-height:1.5;">
      If the button doesn't work, paste this into your browser:<br>
      <span style="word-break:break-all;">${url}</span>
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
    <p style="color:#94a3b8;font-size:11px;line-height:1.5;">
      Someone — possibly you — asked to reset the password for this AwaazOS
      account. If it wasn't you, ignore this email; your password will not change.
    </p>
  </div>
</body>
</html>`;
}

/**
 * Post the message. Returns the provider message id, or null on any failure —
 * failures are logged, never thrown, so the caller's timing stays uniform.
 */
async function deliver(
  config: MailConfig,
  body: { to: string[]; subject: string; text: string; html: string; labels?: string[] },
  event = "email.password_reset",
): Promise<string | null> {
  const endpoint = `${AGENTMAIL_API_BASE}/inboxes/${encodeURIComponent(config.inboxId)}/messages/send`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.error(
        { status: res.status, detail: detail.slice(0, 300) },
        `${event}.rejected`,
      );
      return null;
    }

    const json = (await res.json().catch(() => ({}))) as { message_id?: string };
    return json.message_id ?? null;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : "unknown" },
      `${event}.request_failed`,
    );
    return null;
  }
}

/**
 * Best-effort send. Always resolves `{ ok: true }` — "delivered", "provider
 * rejected it" and "no provider configured" must be indistinguishable to the
 * caller.
 */
export async function sendPasswordResetEmail(
  input: SendPasswordResetEmailInput,
): Promise<{ ok: true }> {
  const { to, name, url, expiresAt } = input;
  const config = getConfig();
  const greetingName = name?.trim() || "there";

  if (!config) {
    logger.warn(
      {
        toMasked: maskEmail(to),
        expiresAt: expiresAt.toISOString(),
        reason: "AGENTMAIL_API_KEY or AGENTMAIL_INBOX_ID not set",
      },
      "email.password_reset.unconfigured",
    );
    return { ok: true };
  }

  const messageId = await deliver(config, {
    to: [to],
    subject: "Reset your AwaazOS password",
    text: buildText(greetingName, url),
    html: buildHtml(greetingName, url),
    labels: ["password-reset", "transactional"],
  });

  logger.info(
    { toMasked: maskEmail(to), messageId, delivered: messageId != null },
    "email.password_reset.sent",
  );

  return { ok: true };
}

// ─── Storefront buyer sign-in (magic link) ──────────────────────────
//
// Same two invariants as the reset flow: never throws (the login route returns
// an identical `{ success: true }` whether or not the email is known), and
// never logs the URL or token.

export type SendCustomerLoginEmailInput = {
  to: string;
  url: string;
  storeName: string;
  expiresAt: Date;
};

function buildCustomerLoginText(storeName: string, url: string): string {
  return [
    "Namaste,",
    "",
    `Here is your sign-in link for ${storeName}.`,
    "It works once and expires in 15 minutes:",
    "",
    url,
    "",
    "If you didn't ask for this, you can ignore this email.",
    "",
    "AwaazOS — Bol. Bill. Becho.",
  ].join("\n");
}

function buildCustomerLoginHtml(storeName: string, url: string): string {
  const store = escapeHtml(storeName);
  const href = escapeHtml(url);
  return `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;margin:0;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;">
    <div style="font-weight:700;font-size:18px;color:#FF6B00;">${store}</div>
    <h1 style="font-size:22px;margin:24px 0 8px 0;color:#1a1a1a;">Sign in to order</h1>
    <p style="color:#334155;line-height:1.5;">
      Namaste,<br><br>
      Tap the button to sign in at ${store}. This link works once and expires in 15 minutes.
    </p>
    <p style="margin:28px 0;">
      <a href="${href}" style="background:#FF6B00;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Sign in
      </a>
    </p>
    <p style="color:#64748b;font-size:12px;line-height:1.5;">
      If the button doesn't work, paste this into your browser:<br>
      <span style="word-break:break-all;">${href}</span>
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
    <p style="color:#94a3b8;font-size:11px;line-height:1.5;">
      Someone — possibly you — asked to sign in with this email on an AwaazOS
      storefront. If it wasn't you, ignore this email.
    </p>
  </div>
</body>
</html>`;
}

/**
 * Best-effort send. Always resolves `{ ok: true }`. Store name is
 * vendor-authored, so it is HTML-escaped and stripped of newlines in the subject.
 */
export async function sendCustomerLoginEmail(
  input: SendCustomerLoginEmailInput,
): Promise<{ ok: true }> {
  try {
    const { to, url, expiresAt } = input;
    const storeName = input.storeName.replace(/[\r\n]+/g, " ").trim().slice(0, 80) || "AwaazOS";
    const config = getConfig();

    if (!config) {
      logger.warn(
        {
          toMasked: maskEmail(to),
          expiresAt: expiresAt.toISOString(),
          reason: "AGENTMAIL_API_KEY or AGENTMAIL_INBOX_ID not set",
        },
        "email.customer_login.unconfigured",
      );
      return { ok: true };
    }

    const messageId = await deliver(config, {
      to: [to],
      subject: `Your sign-in link for ${storeName}`,
      text: buildCustomerLoginText(storeName, url),
      html: buildCustomerLoginHtml(storeName, url),
      labels: ["customer-login", "transactional"],
    }, "email.customer_login");

    logger.info(
      { toMasked: maskEmail(to), messageId, delivered: messageId != null },
      "email.customer_login.sent",
    );
  } catch {
    // Invariant 1: never throw. No detail logged — it could carry the URL.
    logger.error({}, "email.customer_login.failed");
  }
  return { ok: true };
}
