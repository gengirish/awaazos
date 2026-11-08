import { NextResponse, type NextRequest } from "next/server";

import { connectReturnPath, parseConnectReturn, type ConnectReturn } from "@/lib/razorpay-connect";
import { OAUTH_STATE_COOKIE } from "@/lib/razorpay-oauth";
import { appBaseUrl } from "@/lib/storefront-razorpay";

/** Path the OAuth cookies are scoped to: only these two routes ever see them. */
export const OAUTH_COOKIE_PATH = "/api/vendor/payments/razorpay";

/**
 * Which page started Connect (lib/razorpay-connect.ts), carried from the connect
 * route to the callback beside the nonce. Holds a fixed name, never a URL.
 */
export const OAUTH_RETURN_COOKIE = "awz_rzp_return";

/** The return the connect route was asked for, or the one its callback carries. */
export function connectReturnFrom(req: NextRequest, source: "query" | "cookie"): ConnectReturn | null {
  return parseConnectReturn(
    source === "query" ? req.nextUrl.searchParams.get("return") : req.cookies.get(OAUTH_RETURN_COOKIE)?.value,
  );
}

/**
 * Browser-navigation answers for the Connect flow: always a redirect back to the
 * page that started it (Settings → Payments, or setup) with a short outcome code,
 * never a JSON body. Built from the env base URL, never the request Host header.
 */
export function backToPayments(outcome: string, ret: ConnectReturn | null = null): NextResponse {
  const res = NextResponse.redirect(
    `${appBaseUrl()}${connectReturnPath(ret)}?razorpay=${encodeURIComponent(outcome)}`,
    303,
  );
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
  res.cookies.set(OAUTH_RETURN_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
  return res;
}

export function toSignIn(ret: ConnectReturn | null = null): NextResponse {
  return NextResponse.redirect(
    `${appBaseUrl()}/sign-in?callbackUrl=${encodeURIComponent(connectReturnPath(ret))}`,
    303,
  );
}
