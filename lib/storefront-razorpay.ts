/**
 * Storefront online payments through the VENDOR's own Razorpay account.
 *
 * Server-only. Every API call authenticates with the vendor's key id + secret,
 * so money settles straight into the vendor's Razorpay balance. The platform
 * never collects on a vendor's behalf (that would make AwaazOS an RBI payment
 * aggregator) — do NOT use lib/razorpay.ts or the platform RAZORPAY_* keys here;
 * those are for AwaazOS's own subscription billing.
 *
 * Plain fetch against https://api.razorpay.com/v1 (no SDK: the SDK is a
 * singleton bound to one account; here every call uses a different one).
 *
 * Never log: key secrets, webhook secrets, signatures, or any customer data.
 * Amounts are integer paise — exactly what Razorpay's `amount` field expects.
 */

import crypto from "node:crypto";

import { PLAN_LIMITS } from "@/lib/constants";
import { effectivePlan, type PlanFields } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { decryptSecret, isSecretBoxConfigured } from "@/lib/secret-box";
import { withTimeout } from "@/lib/with-timeout";

const RAZORPAY_API = "https://api.razorpay.com/v1";
const RAZORPAY_TIMEOUT_MS = 8_000;

export const RAZORPAY_KEY_ID_PATTERN = /^rzp_(live|test)_[A-Za-z0-9]{8,32}$/;

/** AAD contexts — bind each ciphertext to its vendor and column. */
export function keySecretAad(vendorId: string): string {
  return `razorpay:key_secret:${vendorId}`;
}
export function webhookSecretAad(vendorId: string): string {
  return `razorpay:webhook_secret:${vendorId}`;
}

export type RazorpayCreds = { keyId: string; keySecret: string };

export type RazorpayOrder = {
  id: string;
  amount: number;
  amount_paid: number;
  currency: string;
  receipt: string | null;
  status: "created" | "attempted" | "paid" | string;
  notes: Record<string, string> | unknown[] | null;
};

export class RazorpayApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly op: string,
  ) {
    // No response body in the message: it can echo request fields.
    super(`Razorpay ${op} failed with HTTP ${status}`);
    this.name = "RazorpayApiError";
  }
}

// ─── Availability ───────────────────────────────────────────────────

type CredFields = {
  razorpayKeyId: string | null;
  razorpayKeySecretEnc: string | null;
  razorpayWebhookSecretEnc: string | null;
};

/** All three credentials saved (no decryption — cheap). */
export function hasStoredRazorpayCreds(s: CredFields | null | undefined): boolean {
  return Boolean(s?.razorpayKeyId && s.razorpayKeySecretEnc && s.razorpayWebhookSecretEnc);
}

/**
 * Plan flag (STARTER and up, incl. the free trial — lib/plan.ts) + saved creds + the
 * encryption key present on this deploy.
 */
export function isOnlinePaymentEnabled(
  vendor: PlanFields,
  s: CredFields | null | undefined,
  now: Date = new Date(),
): boolean {
  return (
    PLAN_LIMITS[effectivePlan(vendor, now)].razorpayLinks &&
    hasStoredRazorpayCreds(s) &&
    isSecretBoxConfigured()
  );
}

/**
 * Decrypt a vendor's key id + secret. Null when not configured or undecryptable
 * (wrong/rotated encryption key) — callers treat both as "online payment unavailable".
 */
export async function getVendorRazorpayCreds(vendorId: string): Promise<RazorpayCreds | null> {
  const s = await prisma.vendorSettings.findUnique({
    where: { vendorId },
    select: { razorpayKeyId: true, razorpayKeySecretEnc: true, razorpayWebhookSecretEnc: true },
  });
  if (!s || !hasStoredRazorpayCreds(s) || !s.razorpayKeyId || !s.razorpayKeySecretEnc) return null;
  try {
    return { keyId: s.razorpayKeyId, keySecret: decryptSecret(s.razorpayKeySecretEnc, keySecretAad(vendorId)) };
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "storefront_razorpay_creds_unreadable",
        vendorId,
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
    return null;
  }
}

// ─── HTTP ───────────────────────────────────────────────────────────

function parseOrder(json: unknown): RazorpayOrder {
  const o = (json ?? {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.amount !== "number") {
    throw new RazorpayApiError(502, "order.parse");
  }
  return {
    id: o.id,
    amount: o.amount,
    amount_paid: typeof o.amount_paid === "number" ? o.amount_paid : 0,
    currency: typeof o.currency === "string" ? o.currency : "INR",
    receipt: typeof o.receipt === "string" ? o.receipt : null,
    status: typeof o.status === "string" ? o.status : "created",
    notes: (o.notes as RazorpayOrder["notes"]) ?? null,
  };
}

/** POST /v1/orders. `amountPaise` is integer paise (Razorpay's unit). */
export async function createRazorpayOrder(args: {
  creds: RazorpayCreds;
  amountPaise: number;
  receipt: string;
  notes: { transactionId: string; vendorId: string };
}): Promise<RazorpayOrder> {
  if (!Number.isInteger(args.amountPaise) || args.amountPaise < 100) {
    // Razorpay's minimum is ₹1 (100 paise).
    throw new RazorpayApiError(400, "orders.create.amount");
  }
  const res = await rzFetchJson(args.creds, "/orders", "orders.create", {
    method: "POST",
    body: {
      amount: args.amountPaise,
      currency: "INR",
      receipt: args.receipt.slice(0, 40),
      notes: args.notes,
    },
  });
  return parseOrder(res);
}

/** GET /v1/orders/:id with the vendor's keys. */
export async function fetchRazorpayOrder(creds: RazorpayCreds, orderId: string): Promise<RazorpayOrder> {
  if (!/^order_[A-Za-z0-9]{6,40}$/.test(orderId)) throw new RazorpayApiError(400, "orders.fetch.id");
  return parseOrder(await rzFetchJson(creds, `/orders/${orderId}`, "orders.fetch"));
}

/**
 * Confirm a key pair works before saving it: GET /v1/orders?count=1.
 * Returns false when Razorpay rejects the keys (401/403); throws on network
 * errors / 5xx so the caller can say "try again" rather than "wrong keys".
 */
export async function validateKeys(creds: RazorpayCreds): Promise<boolean> {
  const { status } = await rzRequest(creds, "/orders?count=1", "orders.list", { method: "GET" }, false);
  if (status >= 200 && status < 300) return true;
  if (status === 400 || status === 401 || status === 403) return false;
  throw new RazorpayApiError(status, "orders.list");
}

async function rzFetchJson(
  creds: RazorpayCreds,
  path: string,
  op: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<unknown> {
  const { status, json } = await rzRequest(creds, path, op, init, true);
  if (status < 200 || status >= 300) throw new RazorpayApiError(status, op);
  return json;
}

/** One authenticated call, hard-capped at RAZORPAY_TIMEOUT_MS (body read included). */
async function rzRequest(
  creds: RazorpayCreds,
  path: string,
  op: string,
  init: { method: "GET" | "POST"; body?: unknown },
  readBody: boolean,
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`, "utf8").toString("base64");
  const run = async () => {
    const res = await fetch(`${RAZORPAY_API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Basic ${auth}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const ok = res.status >= 200 && res.status < 300;
    const json: unknown = readBody && ok ? await res.json() : null;
    return { status: res.status, json };
  };
  try {
    return await withTimeout(run(), RAZORPAY_TIMEOUT_MS, `razorpay.${op}`);
  } finally {
    // Cancels the socket if the timeout won; harmless once the call settled.
    controller.abort();
  }
}

// ─── Signatures ─────────────────────────────────────────────────────

function hmacHex(secret: string, data: string): string {
  return crypto.createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

function safeHexEqual(a: string, expectedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a)) return false;
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(expectedHex, "hex");
  if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/** Checkout success handler: HMAC-SHA256(`${orderId}|${paymentId}`, keySecret). */
export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string | null | undefined,
  keySecret: string,
): boolean {
  if (!signature || !orderId || !paymentId || !keySecret) return false;
  return safeHexEqual(signature, hmacHex(keySecret, `${orderId}|${paymentId}`));
}

/** Webhook: HMAC-SHA256(rawBody, webhookSecret) vs `X-Razorpay-Signature`. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  webhookSecret: string,
): boolean {
  if (!signature || !webhookSecret) return false;
  return safeHexEqual(signature, hmacHex(webhookSecret, rawBody));
}

// ─── Webhook URL ────────────────────────────────────────────────────

/**
 * Public origin for the per-vendor webhook URL shown in settings. Env-only, never
 * the request Host header (attacker-controlled) — same rule as password reset.
 */
export function appBaseUrl(): string {
  const explicit = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = explicit ?? (vercel ? `https://${vercel}` : undefined) ?? "http://localhost:3000";
  return base.replace(/\/$/, "");
}

/** The URL a vendor pastes into Razorpay Dashboard → Webhooks. */
export function vendorWebhookUrl(vendorId: string): string {
  return `${appBaseUrl()}/api/webhooks/razorpay-orders/${encodeURIComponent(vendorId)}`;
}

// ─── Storefront order lookup ────────────────────────────────────────

/**
 * Buyer-side lookup for the public payment routes: 192-bit order token + the
 * storefront gate (active vendor, publishStorefront). No customer PII selected.
 */
export async function findStorefrontOrderForPayment(slug: string, token: string) {
  return prisma.transaction.findFirst({
    where: {
      orderToken: token,
      source: "STOREFRONT",
      vendor: { slug, isActive: true, settings: { is: { publishStorefront: true } } },
    },
    select: {
      id: true,
      vendorId: true,
      billNumber: true,
      totalPaise: true,
      paymentMethod: true,
      paymentStatus: true,
      fulfilmentStatus: true,
      upiRef: true,
      paymentClaimedAt: true,
      createdAt: true,
      razorpayOrderId: true,
      vendor: {
        select: {
          name: true,
          plan: true,
          planExpiresAt: true,
          trialEndsAt: true,
          settings: {
            select: { razorpayKeyId: true, razorpayKeySecretEnc: true, razorpayWebhookSecretEnc: true },
          },
        },
      },
    },
  });
}
