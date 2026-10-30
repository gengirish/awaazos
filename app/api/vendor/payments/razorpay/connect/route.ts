import { NextRequest, NextResponse } from "next/server";

import {
  authorizeUrl,
  createOauthState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_S,
  oauthRedirectUri,
  razorpayOauthConfig,
} from "@/lib/razorpay-oauth";
import { tooManyRequests, writeRateLimit } from "@/lib/ratelimit";
import { AuthError, PlanGateError, requirePlan, requireVendorRole } from "@/lib/rbac";
import { isSecretBoxConfigured } from "@/lib/secret-box";
import { appBaseUrl } from "@/lib/storefront-razorpay";

import { backToPayments, OAUTH_COOKIE_PATH, toSignIn } from "../_redirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Connect Razorpay", step 1: the seller's browser lands here from Settings →
 * Payments and is sent to Razorpay's consent page. OWNER + STARTER, the same gate
 * as saving API keys (PUT /api/vendor/payments).
 *
 * The signed `state` names the active vendor; its nonce also goes in an httpOnly
 * cookie scoped to the callback, so the flow can only finish in this browser.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    requirePlan(ctx.vendor, "STARTER");
    const cfg = razorpayOauthConfig();
    if (!cfg || !isSecretBoxConfigured()) return backToPayments("unavailable");

    const rl = await writeRateLimit.check(`razorpay-connect:${ctx.vendor.id}`);
    if (!rl.ok) return tooManyRequests(rl, "razorpay-connect");

    const { state, nonce } = createOauthState(ctx.vendor.id);
    const res = NextResponse.redirect(authorizeUrl(cfg, oauthRedirectUri(appBaseUrl()), state), 303);
    res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
      path: OAUTH_COOKIE_PATH,
      httpOnly: true,
      // Lax: Razorpay's redirect back is a top-level GET, which still carries it.
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: OAUTH_STATE_MAX_AGE_S,
    });
    if (ctx.setVendorCookie) {
      res.cookies.set("awz_vendor", ctx.setVendorCookie, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
    return res;
  } catch (err) {
    if (err instanceof PlanGateError) return backToPayments("upgrade");
    if (err instanceof AuthError) return err.status === 401 ? toSignIn() : backToPayments("owner_only");
    console.error(JSON.stringify({ event: "razorpay_connect_failed", error: err instanceof Error ? err.name : "unknown" }));
    return backToPayments("error");
  }
}
