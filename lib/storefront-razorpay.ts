/**
 * Storefront online payments through the VENDOR's own Razorpay account.
 *
 * Server-only. Every API call authenticates as the vendor — with her key id +
 * secret, or with the OAuth access token from "Connect Razorpay"
 * (lib/razorpay-oauth.ts) — so money settles straight into her Razorpay balance. The platform
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
import {
  isRazorpayOauthConfigured,
  type OauthTokens,
  razorpayOauthConfig,
  refreshTokens,
  revokeToken,
} from "@/lib/razorpay-oauth";
import { decryptSecret, encryptSecret, isSecretBoxConfigured } from "@/lib/secret-box";
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

export function accessTokenAad(vendorId: string): string {
  return `razorpay:oauth_access:${vendorId}`;
}
export function refreshTokenAad(vendorId: string): string {
  return `razorpay:oauth_refresh:${vendorId}`;
}

/** Pasted API keys (`keys`) or a "Connect Razorpay" OAuth token (`oauth`). */
export type KeyCreds = { kind: "keys"; keyId: string; keySecret: string };
export type OauthCreds = { kind: "oauth"; accessToken: string; publicToken: string; accountId: string };
export type RazorpayCreds = KeyCreds | OauthCreds;

/** The `key` Razorpay Checkout needs in the browser — public by design. */
export function checkoutKey(creds: RazorpayCreds): string {
  return creds.kind === "keys" ? creds.keyId : creds.publicToken;
}

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

export type CredFields = {
  razorpayKeyId: string | null;
  razorpayKeySecretEnc: string | null;
  razorpayWebhookSecretEnc: string | null;
  razorpayAccountId: string | null;
  razorpayAccessTokenEnc: string | null;
  razorpayRefreshTokenEnc: string | null;
  razorpayPublicToken: string | null;
  razorpayTokenExpiresAt: Date | null;
  razorpayRefreshExpiresAt: Date | null;
};

/** Prisma `select` for everything the availability checks read. Secrets stay encrypted. */
export const RAZORPAY_CRED_SELECT = {
  razorpayKeyId: true,
  razorpayKeySecretEnc: true,
  razorpayWebhookSecretEnc: true,
  razorpayAccountId: true,
  razorpayAccessTokenEnc: true,
  razorpayRefreshTokenEnc: true,
  razorpayPublicToken: true,
  razorpayTokenExpiresAt: true,
  razorpayRefreshExpiresAt: true,
} as const;

/** `data` that removes a "Connect Razorpay" connection. */
export const CLEARED_OAUTH_COLUMNS = {
  razorpayAccountId: null,
  razorpayAccessTokenEnc: null,
  razorpayRefreshTokenEnc: null,
  razorpayPublicToken: null,
  razorpayTokenExpiresAt: null,
  razorpayRefreshExpiresAt: null,
};

/** `data` that removes pasted API keys. */
export const CLEARED_KEY_COLUMNS = {
  razorpayKeyId: null,
  razorpayKeySecretEnc: null,
  razorpayWebhookSecretEnc: null,
};

type KeyFields = Pick<CredFields, "razorpayKeyId" | "razorpayKeySecretEnc" | "razorpayWebhookSecretEnc">;
type OauthFields = Pick<
  CredFields,
  "razorpayAccountId" | "razorpayAccessTokenEnc" | "razorpayRefreshTokenEnc" | "razorpayPublicToken" | "razorpayRefreshExpiresAt"
>;

/** All three pasted credentials saved (no decryption — cheap). */
export function hasStoredRazorpayKeys(s: Partial<KeyFields> | null | undefined): boolean {
  return Boolean(s?.razorpayKeyId && s.razorpayKeySecretEnc && s.razorpayWebhookSecretEnc);
}

/** An OAuth connection is saved, whether or not its refresh token is still alive. */
export function hasOauthConnection(s: Partial<OauthFields> | null | undefined): boolean {
  return Boolean(s?.razorpayAccountId && s.razorpayAccessTokenEnc && s.razorpayRefreshTokenEnc && s.razorpayPublicToken);
}

/** Connected and the refresh token hasn't run out (past it the seller must reconnect). */
export function hasLiveOauthConnection(s: Partial<OauthFields> | null | undefined, now: Date = new Date()): boolean {
  return hasOauthConnection(s) && Boolean(s?.razorpayRefreshExpiresAt && s.razorpayRefreshExpiresAt > now);
}

/** Usable credentials of either kind are saved (no decryption — cheap). */
export function hasStoredRazorpayCreds(s: Partial<CredFields> | null | undefined, now: Date = new Date()): boolean {
  return hasStoredRazorpayKeys(s) || hasLiveOauthConnection(s, now);
}

/**
 * Plan flag (STARTER and up, incl. the free trial — lib/plan.ts) + usable creds + the
 * encryption key present on this deploy. An OAuth connection also needs the partner
 * app configured, because renewing its token needs the client secret.
 */
export function isOnlinePaymentEnabled(
  vendor: PlanFields,
  s: Partial<CredFields> | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!PLAN_LIMITS[effectivePlan(vendor, now)].razorpayLinks || !isSecretBoxConfigured()) return false;
  if (hasLiveOauthConnection(s, now) && isRazorpayOauthConfigured()) return true;
  return hasStoredRazorpayKeys(s);
}

/** Renew the access token once it has less than this left. */
const ACCESS_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function accessTokenNeedsRefresh(expiresAt: Date | null, now: Date = new Date()): boolean {
  return !expiresAt || expiresAt.getTime() - now.getTime() < ACCESS_REFRESH_WINDOW_MS;
}

/** VendorSettings `data` for a fresh token set (connect or refresh). */
export function oauthColumnsFromTokens(vendorId: string, t: OauthTokens) {
  return {
    razorpayAccountId: t.accountId,
    razorpayAccessTokenEnc: encryptSecret(t.accessToken, accessTokenAad(vendorId)),
    razorpayRefreshTokenEnc: encryptSecret(t.refreshToken, refreshTokenAad(vendorId)),
    razorpayPublicToken: t.publicToken,
    razorpayTokenExpiresAt: t.accessExpiresAt,
    razorpayRefreshExpiresAt: t.refreshExpiresAt,
  };
}

function logCredsUnreadable(vendorId: string, kind: "keys" | "oauth", err: unknown) {
  console.warn(
    JSON.stringify({
      event: "storefront_razorpay_creds_unreadable",
      vendorId,
      kind,
      error: err instanceof Error ? err.name : "unknown",
    }),
  );
}

/**
 * The vendor's credentials, OAuth first. Null when not configured, undecryptable
 * (wrong/rotated encryption key) or an OAuth token that can't be renewed —
 * callers treat all of these as "online payment unavailable".
 *
 * An access token near expiry is renewed HERE, when a buyer pays. No timer: a
 * store nobody pays online for 180 days just has to reconnect.
 */
export async function getVendorRazorpayCreds(vendorId: string, now: Date = new Date()): Promise<RazorpayCreds | null> {
  const s = await prisma.vendorSettings.findUnique({ where: { vendorId }, select: RAZORPAY_CRED_SELECT });
  if (!s) return null;

  if (hasLiveOauthConnection(s, now) && isRazorpayOauthConfigured()) {
    const base = { kind: "oauth" as const, publicToken: s.razorpayPublicToken!, accountId: s.razorpayAccountId! };
    let accessToken: string | null = null;
    try {
      accessToken = decryptSecret(s.razorpayAccessTokenEnc!, accessTokenAad(vendorId));
    } catch (err) {
      logCredsUnreadable(vendorId, "oauth", err);
    }
    if (accessToken && !accessTokenNeedsRefresh(s.razorpayTokenExpiresAt, now)) return { ...base, accessToken };
    const refreshed = await refreshVendorTokens(vendorId, now);
    if (refreshed) return refreshed;
    // Renewal failed: the old token still works until it actually expires.
    if (accessToken && s.razorpayTokenExpiresAt && s.razorpayTokenExpiresAt > now) return { ...base, accessToken };
    return null;
  }

  if (!hasStoredRazorpayKeys(s) || !s.razorpayKeyId || !s.razorpayKeySecretEnc) return null;
  try {
    return { kind: "keys", keyId: s.razorpayKeyId, keySecret: decryptSecret(s.razorpayKeySecretEnc, keySecretAad(vendorId)) };
  } catch (err) {
    logCredsUnreadable(vendorId, "keys", err);
    return null;
  }
}

/**
 * Renew the vendor's token pair. Razorpay ROTATES refresh tokens (the old one dies
 * when a new one is issued), so two buyers paying at once must not both refresh:
 * the row is locked, re-read, and refreshed only if nobody beat us to it.
 */
async function refreshVendorTokens(vendorId: string, now: Date): Promise<OauthCreds | null> {
  const cfg = razorpayOauthConfig();
  if (!cfg) return null;
  try {
    return await prisma.$transaction(
      async (tx): Promise<OauthCreds | null> => {
        await tx.$queryRaw`SELECT 1 FROM "vendor_settings" WHERE "vendorId" = ${vendorId} FOR UPDATE`;
        const s = await tx.vendorSettings.findUnique({ where: { vendorId }, select: RAZORPAY_CRED_SELECT });
        if (!s || !hasLiveOauthConnection(s, now)) return null;
        if (!accessTokenNeedsRefresh(s.razorpayTokenExpiresAt, now)) {
          // Another request renewed it while we waited for the lock.
          return {
            kind: "oauth",
            accessToken: decryptSecret(s.razorpayAccessTokenEnc!, accessTokenAad(vendorId)),
            publicToken: s.razorpayPublicToken!,
            accountId: s.razorpayAccountId!,
          };
        }
        const tokens = await refreshTokens(cfg, decryptSecret(s.razorpayRefreshTokenEnc!, refreshTokenAad(vendorId)));
        if (tokens.accountId !== s.razorpayAccountId) return null;
        await tx.vendorSettings.update({ where: { vendorId }, data: oauthColumnsFromTokens(vendorId, tokens) });
        console.info(JSON.stringify({ event: "storefront_razorpay_token_refreshed", vendorId }));
        return { kind: "oauth", accessToken: tokens.accessToken, publicToken: tokens.publicToken, accountId: tokens.accountId };
      },
      // The Razorpay call runs inside the lock; leave room past its own 8 s cap.
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "storefront_razorpay_token_refresh_failed",
        vendorId,
        error: err instanceof Error ? err.name : "unknown",
        status: (err as { status?: unknown } | null)?.status ?? null,
      }),
    );
    return null;
  }
}

/**
 * Ask Razorpay to drop our access to the vendor's account. Best effort and
 * read-only: the caller clears the columns whatever Razorpay answers.
 */
export async function revokeVendorOauth(vendorId: string): Promise<void> {
  const cfg = razorpayOauthConfig();
  if (!cfg) return;
  const s = await prisma.vendorSettings.findUnique({
    where: { vendorId },
    select: { razorpayRefreshTokenEnc: true, razorpayAccessTokenEnc: true },
  });
  try {
    if (s?.razorpayRefreshTokenEnc) {
      await revokeToken(cfg, decryptSecret(s.razorpayRefreshTokenEnc, refreshTokenAad(vendorId)), "refresh_token");
    }
    if (s?.razorpayAccessTokenEnc) {
      await revokeToken(cfg, decryptSecret(s.razorpayAccessTokenEnc, accessTokenAad(vendorId)), "access_token");
    }
  } catch (err) {
    logCredsUnreadable(vendorId, "oauth", err);
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

/** GET /v1/orders/:id as the vendor. */
export async function fetchRazorpayOrder(creds: RazorpayCreds, orderId: string): Promise<RazorpayOrder> {
  if (!/^order_[A-Za-z0-9]{6,40}$/.test(orderId)) throw new RazorpayApiError(400, "orders.fetch.id");
  return parseOrder(await rzFetchJson(creds, `/orders/${orderId}`, "orders.fetch"));
}

/**
 * Confirm a key pair works before saving it: GET /v1/orders?count=1.
 * Returns false when Razorpay rejects the keys (401/403); throws on network
 * errors / 5xx so the caller can say "try again" rather than "wrong keys".
 */
export async function validateKeys(creds: { keyId: string; keySecret: string }): Promise<boolean> {
  const { status } = await rzRequest({ kind: "keys", ...creds }, "/orders?count=1", "orders.list", { method: "GET" }, false);
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
  const authorization =
    creds.kind === "keys"
      ? `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`, "utf8").toString("base64")}`
      : `Bearer ${creds.accessToken}`;
  const run = async () => {
    const res = await fetch(`${RAZORPAY_API}${path}`, {
      method: init.method,
      headers: {
        Authorization: authorization,
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
          settings: { select: RAZORPAY_CRED_SELECT },
        },
      },
    },
  });
}
