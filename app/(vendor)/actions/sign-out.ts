"use server";

import { cookies } from "next/headers";

import { signOut } from "@/lib/auth";

/**
 * Ends the vendor (staff) session. Node-only: imports lib/auth.ts, so it must
 * never be imported by middleware.ts.
 *
 * Clears `awz_vendor` with the same attributes it is set with (path "/",
 * httpOnly, sameSite lax, secure in production) so the next person to sign in
 * on a shared counter device starts from their own oldest membership.
 *
 * Does not redirect: the client does a full-page navigation to /sign-in, which
 * (unlike a router transition) passes through public/sw.js, drops the cached
 * /pos page holding this vendor's menu and revenue, and resets in-memory
 * state such as the cart.
 */
export async function signOutVendor(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("awz_vendor", "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
  await signOut({ redirect: false });
}
