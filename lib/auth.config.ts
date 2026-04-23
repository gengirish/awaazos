import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@prisma/client";

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/sign-in" || pathname.startsWith("/sign-in/")) return true;
  if (pathname === "/sign-up" || pathname.startsWith("/sign-up/")) return true;
  if (pathname === "/pricing" || pathname.startsWith("/pricing/")) return true;
  if (pathname === "/features" || pathname.startsWith("/features/")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  return false;
}

/**
 * Edge-safe Auth.js config — no Prisma, no Credentials provider.
 * Imported only by `middleware.ts` and spread into `lib/auth.ts`.
 */
export const authConfig = {
  pages: { signIn: "/sign-in" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const pathname = request.nextUrl.pathname;
      if (isPublicPath(pathname)) return true;
      // /(vendor)/*, /api/* (except auth + webhook matcher exclusions), /onboarding, etc.
      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id ?? token.sub ?? "";
        token.role = (user as { role?: UserRole }).role ?? "USER";
      }
      if (!token.id && token.sub) {
        token.id = token.sub;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string);
        session.user.role = token.role as UserRole;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
