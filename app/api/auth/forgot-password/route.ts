import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { sendPasswordResetEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
} from "@/lib/password-reset";
import { authRateLimit, getClientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email().max(128),
});

/**
 * POST /api/auth/forgot-password
 *
 * Public. ALWAYS returns `{ ok: true }` — bad JSON, unknown email, rate
 * limit and internal failure are indistinguishable to the caller. Anything
 * else lets an attacker enumerate which vendors have accounts.
 *
 * Public path is granted by `isPublicPath()` in lib/auth.config.ts via the
 * blanket `/api/auth` prefix rule.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Pad every response into a uniform-ish window so the DB-hit path and the
  // no-op path can't be told apart by timing. Started before any work and
  // awaited on every exit.
  const padMs = 50 + Math.floor(Math.random() * 100);
  const padPromise = new Promise<void>((resolve) => setTimeout(resolve, padMs));
  const ok = async () => {
    await padPromise;
    return NextResponse.json({ ok: true });
  };

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return ok();
  }

  const email = parsed.email.trim().toLowerCase();
  const ip = getClientIp(req);

  try {
    const rl = await authRateLimit.check(`forgot:${ip}:${email}`);
    if (!rl.ok) return ok();
  } catch (err) {
    // Fail open: a KV outage must not take password recovery down with it.
    logger.warn({ err: err instanceof Error ? err.message : "unknown" }, "forgot_password.limiter_failed_open");
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });

    if (user) {
      const token = generateResetToken();
      const expiresAt = resetTokenExpiry();

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashResetToken(token),
          expiresAt,
          requestIp: ip,
        },
      });

      const base = (process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")
        .replace(/\/$/, "");
      const url = `${base}/reset-password?token=${token}`;

      await sendPasswordResetEmail({ to: user.email, name: user.name, url, expiresAt });
    }
  } catch (err) {
    // Swallowed on purpose — surfacing this would break the uniform response.
    logger.error(
      { err: err instanceof Error ? err.message : "unknown" },
      "forgot_password.issue_failed",
    );
  }

  return ok();
}
