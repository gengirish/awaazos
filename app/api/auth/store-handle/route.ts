import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getClientIp, storeHandleRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { STORE_HANDLE_TAKEN_MESSAGE, storeHandleProblem } from "@/lib/store-handle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/store-handle?handle=<handle>
 *
 * "Is this store link free?" for the sign-up form and Settings → Online store,
 * answered while the owner types. Public (sign-up has no session) and rate
 * limited per IP. It reveals only whether a handle exists, which the public
 * /s/<handle> page already does for a published store; nothing about the vendor
 * is returned. The register and settings routes still decide on write — this
 * is a courtesy, not a reservation.
 *
 * 200 `{ data: { handle, available, reason? } }`; a handle that breaks the
 * rules is `available: false` with the rule it breaks.
 */
export async function GET(req: NextRequest) {
  const rl = await storeHandleRateLimit.check(getClientIp(req));
  if (!rl.ok) return tooManyRequests(rl, "store-handle");

  const handle = (req.nextUrl.searchParams.get("handle") ?? "").trim().toLowerCase();
  const problem = storeHandleProblem(handle);
  if (problem) {
    return NextResponse.json({ data: { handle, available: false, reason: problem } });
  }

  try {
    const existing = await prisma.vendor.findUnique({ where: { slug: handle }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ data: { handle, available: false, reason: STORE_HANDLE_TAKEN_MESSAGE } });
    }
    return NextResponse.json({ data: { handle, available: true } });
  } catch (err) {
    console.error("[auth/store-handle] lookup failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
