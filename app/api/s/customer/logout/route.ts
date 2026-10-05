import { NextResponse } from "next/server";

import { CUSTOMER_SESSION_COOKIE, destroySession, sessionCookieOptions } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/s/customer/logout — delete the session row and clear the cookie. */
export async function POST() {
  try {
    await destroySession();
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "customer_logout_failed",
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
  }
  const res = NextResponse.json({ success: true });
  res.cookies.set(CUSTOMER_SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return res;
}
