import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/password";
import { checkPasswordPolicy } from "@/lib/password-strength";
import { hashResetToken } from "@/lib/password-reset";
import { prisma } from "@/lib/prisma";
import { authRateLimit, getClientIp, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().min(16).max(256),
  newPassword: z.string().min(8).max(128),
});

/** Every token failure returns exactly this — never say which of the three it was. */
const GENERIC_ERROR = { ok: false, error: "Invalid or expired token" } as const;

/**
 * POST /api/auth/reset-password
 *
 * Public. Consumes a single-use token from /forgot-password and rotates the
 * password. "No such token", "expired" and "already used" are deliberately
 * indistinguishable. A weak new password is the one case that gets a
 * specific message — the caller already holds a valid token, so there is
 * nothing left to enumerate and a vague error would just be bad UX.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const ip = getClientIp(req);
  try {
    const rl = await authRateLimit.check(`reset:${ip}`);
    if (!rl.ok) return tooManyRequests(rl, "reset-password");
  } catch {
    // Fail open — see forgot-password.
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(GENERIC_ERROR, { status: 400 });
  }

  const policy = checkPasswordPolicy(body.newPassword);
  if (!policy.ok) {
    return NextResponse.json({ ok: false, error: policy.reason }, { status: 400 });
  }

  try {
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(body.token) },
      select: { id: true, userId: true, usedAt: true, expiresAt: true },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json(GENERIC_ERROR, { status: 400 });
    }

    const passwordHash = await hashPassword(body.newPassword);

    // Burn the token and rotate the password atomically. If a concurrent
    // request consumed the same token first, `burned.count` is 0 and we back
    // out without touching the password.
    const result = await prisma.$transaction(async (tx) => {
      const burned = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (burned.count !== 1) return { ok: false as const };

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });

      // Any other outstanding link for this account dies with it, so a
      // second reset email left in an inbox is not still live.
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      });

      return { ok: true as const };
    });

    if (!result.ok) {
      return NextResponse.json(GENERIC_ERROR, { status: 400 });
    }

    logger.info({ userId: record.userId }, "password_reset.completed");
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : "unknown" },
      "password_reset.failed",
    );
    return NextResponse.json(GENERIC_ERROR, { status: 400 });
  }
}
