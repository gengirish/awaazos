import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AdminInviteError, redeemAdminInviteAsNewUser } from "@/lib/admin-invites";
import { logger } from "@/lib/logger";
import { checkPasswordPolicy } from "@/lib/password-strength";
import { authRateLimit, getClientIp, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().min(16).max(256),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(128),
});

/**
 * POST /api/admin-invite — public. Redeems an admin invite for an email with
 * no account yet: creates it as a platform ADMIN with the invitee's own
 * password (lib/admin-invites.ts). "No such token", "expired" and "used" are
 * one error.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const rl = await authRateLimit.check(`admin-invite:${getClientIp(req)}`);
  if (!rl.ok) return tooManyRequests(rl, "admin-invite");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 400 });
  }
  const policy = checkPasswordPolicy(body.password);
  if (!policy.ok) return NextResponse.json({ error: "weak_password", reason: policy.reason }, { status: 400 });

  try {
    const { email } = await redeemAdminInviteAsNewUser(body);
    return NextResponse.json({ data: { email } });
  } catch (err) {
    if (err instanceof AdminInviteError) return NextResponse.json({ error: err.code }, { status: err.status });
    logger.error({ route: "POST /api/admin-invite", error: err instanceof Error ? err.message : "unknown" }, "admin invite failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
