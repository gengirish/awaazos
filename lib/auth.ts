import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { ZodError } from "zod";
import type { User } from "@prisma/client";

import { authConfig } from "@/lib/auth.config";
import { emailRateKey } from "@/lib/customer-auth";
import "@/lib/env";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { getClientIp, makeLimiter } from "@/lib/ratelimit";
import { isSessionStale } from "@/lib/session-freshness";
import { signInSchema } from "@/lib/zod-auth";

/**
 * Staff password sign-in limits. Per IP is loose (mobile carriers put many
 * phones behind one address); per email (hashed key) is what stops guessing
 * one owner's password. Like every limiter here it fails open on a Redis error.
 */
const signInIpLimit = makeLimiter({ name: "sign-in-ip", windowMs: 15 * 60_000, max: 50 });
const signInEmailLimit = makeLimiter({ name: "sign-in-email", windowMs: 15 * 60_000, max: 10 });

/** `res.code` on the client; the sign-in page shows "Too many attempts". */
export class SignInRateLimited extends CredentialsSignin {
  code = "rate_limited";
}

/** bcrypt (cost 12) of a random string nobody kept: compared against when the email is unknown. */
const DUMMY_PASSWORD_HASH = "$2a$12$sK3MRuDUaVvSXQMsmtnBp.n80sl1DQPhQ9UEdIWjT9/YP6Odil2ou";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        try {
          const { email, password } = await signInSchema.parseAsync(credentials);
          const normalizedEmail = email.trim().toLowerCase();
          // Before any DB read. Both buckets count every attempt, known email or not.
          const ipRl = await signInIpLimit.check(getClientIp(request));
          if (!ipRl.ok) throw new SignInRateLimited();
          const emailRl = await signInEmailLimit.check(emailRateKey(normalizedEmail));
          if (!emailRl.ok) throw new SignInRateLimited();
          const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: {
              id: true,
              email: true,
              name: true,
              image: true,
              role: true,
              passwordHash: true,
            },
          });
          // An unknown email still pays for one bcrypt compare, so timing
          // doesn't tell which emails have an account.
          const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
          if (!user?.passwordHash || !passwordOk) return null;
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role,
          };
        } catch (err) {
          if (err instanceof ZodError) return null;
          throw err;
        }
      },
    }),
  ],
});

export async function requireUser(): Promise<{ user: User }> {
  const session = await auth();
  const sessionUserId = session?.user?.id;
  if (!sessionUserId) {
    throw new Error("Unauthorized");
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
  });
  // A session from before the last password reset is dead here too, as in
  // lib/rbac.ts: DELETE /api/me erases the account and its stores.
  if (!user || isSessionStale(user.passwordChangedAt, session.user.tokenIssuedAt)) {
    throw new Error("Unauthorized");
  }

  return { user };
}
