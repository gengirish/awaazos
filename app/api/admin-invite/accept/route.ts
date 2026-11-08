import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AdminInviteError, redeemAdminInviteAsUser } from "@/lib/admin-invites";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { authRateLimit, getClientIp, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ token: z.string().min(16).max(256) });

/**
 * POST /api/admin-invite/accept — signed in. The current account takes an
 * admin invite sent to its own email and becomes a platform ADMIN (a
 * SUPER_ADMIN stays one). A link for another email answers like a dead link.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await authRateLimit.check(`admin-invite:${getClientIp(req)}`);
  if (!rl.ok) return tooManyRequests(rl, "admin-invite");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 400 });
  }

  try {
    await redeemAdminInviteAsUser(body.token, session.user.id);
    logger.info({ route: "POST /api/admin-invite/accept", userId: session.user.id }, "admin invite accepted");
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AdminInviteError) return NextResponse.json({ error: err.code }, { status: err.status });
    logger.error(
      { route: "POST /api/admin-invite/accept", error: err instanceof Error ? err.message : "unknown" },
      "admin invite accept failed",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
