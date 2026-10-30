import { NextResponse } from "next/server";

import { OAUTH_STATE_COOKIE } from "@/lib/razorpay-oauth";
import { appBaseUrl } from "@/lib/storefront-razorpay";

/** Path the OAuth nonce cookie is scoped to: only these two routes ever see it. */
export const OAUTH_COOKIE_PATH = "/api/vendor/payments/razorpay";

/**
 * Browser-navigation answers for the Connect flow: always a redirect back to
 * Settings → Payments with a short outcome code, never a JSON body. Built from
 * the env base URL, never the request Host header.
 */
export function backToPayments(outcome: string): NextResponse {
  const res = NextResponse.redirect(`${appBaseUrl()}/settings/payments?razorpay=${encodeURIComponent(outcome)}`, 303);
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
  return res;
}

export function toSignIn(): NextResponse {
  return NextResponse.redirect(`${appBaseUrl()}/sign-in?callbackUrl=${encodeURIComponent("/settings/payments")}`, 303);
}
