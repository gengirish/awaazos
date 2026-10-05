import { NextResponse, type NextRequest } from "next/server";

import {
  CUSTOMER_SESSION_COOKIE,
  consumeLoginToken,
  createSession,
  sessionCookieOptions,
} from "@/lib/customer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/s/customer/verify?token=… — the magic-link landing.
 *
 * Valid → create session, set `awz_cust`, 303 to the token's stored returnTo.
 * Invalid / used / expired → 303 to returnTo (if the row exists) with
 * `?login=expired`, else to "/". The redirect target only ever comes from the
 * DB row, which was validated by safeReturnTo when minted — never from the
 * query string — and the Location is a relative path, so no open redirect.
 *
 * The token is never logged.
 */

function redirectTo(path: string): NextResponse {
  const res = new NextResponse(null, { status: 303, headers: { Location: path } });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

function withLoginFlag(path: string, flag: string): string {
  const hashAt = path.indexOf("#");
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : path.slice(hashAt);
  return `${base}${base.includes("?") ? "&" : "?"}login=${flag}${hash}`;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  try {
    const result = await consumeLoginToken(token);
    if (!result.ok) {
      return redirectTo(result.returnTo ? withLoginFlag(result.returnTo, "expired") : "/");
    }

    const session = await createSession(result.customerId);
    const res = redirectTo(result.returnTo ?? "/");
    res.cookies.set(CUSTOMER_SESSION_COOKIE, session.rawToken, sessionCookieOptions(session.expiresAt));
    return res;
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "customer_verify_failed",
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
    return redirectTo("/");
  }
}
