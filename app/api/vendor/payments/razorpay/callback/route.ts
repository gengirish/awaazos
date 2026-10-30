import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { clearRazorpayIssue } from "@/lib/razorpay-issue";
import {
  exchangeCode,
  OAUTH_STATE_COOKIE,
  oauthRedirectUri,
  publicTokenMode,
  razorpayOauthConfig,
  readOauthState,
} from "@/lib/razorpay-oauth";
import { AuthError, PlanGateError, requirePlan, requireVendorRole } from "@/lib/rbac";
import { isSecretBoxConfigured } from "@/lib/secret-box";
import { appBaseUrl, CLEARED_KEY_COLUMNS, oauthColumnsFromTokens } from "@/lib/storefront-razorpay";

import { backToPayments, toSignIn } from "../_redirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Connect Razorpay", step 2: Razorpay sends the seller back here with `code` +
 * `state` (or `error`). Must be whitelisted on the partner app.
 *
 * Order matters: the state's HMAC, expiry and cookie nonce are checked first; then
 * the signed-in user must be an OWNER of exactly the vendor the state names
 * (requireVendorRole falls back to another membership when it isn't one, so the
 * id is compared explicitly — a miss is the same "not found" as any other).
 * Only then is the code exchanged and the tokens stored, encrypted.
 *
 * Connecting replaces pasted API keys, so a store has one way in at a time.
 * Every outcome is a redirect to Settings → Payments with a code; the code,
 * state and tokens are never logged.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const vendorId = readOauthState(params.get("state"), req.cookies.get(OAUTH_STATE_COOKIE)?.value);
  if (!vendorId) return backToPayments("expired");

  const rzError = params.get("error");
  if (rzError) return backToPayments(rzError === "access_denied" ? "denied" : "error");
  const code = params.get("code");
  if (!code || code.length > 2048) return backToPayments("error");

  try {
    const ctx = await requireVendorRole("OWNER", vendorId, req);
    if (ctx.vendor.id !== vendorId) return backToPayments("owner_only");
    requirePlan(ctx.vendor, "STARTER");
    const cfg = razorpayOauthConfig();
    if (!cfg || !isSecretBoxConfigured()) return backToPayments("unavailable");

    const tokens = await exchangeCode(cfg, code, oauthRedirectUri(appBaseUrl()));
    const data = { ...oauthColumnsFromTokens(vendorId, tokens), ...CLEARED_KEY_COLUMNS };
    await prisma.vendorSettings.upsert({ where: { vendorId }, create: { vendorId, ...data }, update: data });
    await clearRazorpayIssue(vendorId);

    console.info(
      JSON.stringify({ event: "razorpay_connected", vendorId, mode: publicTokenMode(tokens.publicToken) }),
    );
    return backToPayments("connected");
  } catch (err) {
    if (err instanceof PlanGateError) return backToPayments("upgrade");
    if (err instanceof AuthError) return err.status === 401 ? toSignIn() : backToPayments("owner_only");
    console.error(
      JSON.stringify({
        event: "razorpay_connect_callback_failed",
        vendorId,
        error: err instanceof Error ? err.name : "unknown",
        status: (err as { status?: unknown } | null)?.status ?? null,
      }),
    );
    return backToPayments("error");
  }
}
