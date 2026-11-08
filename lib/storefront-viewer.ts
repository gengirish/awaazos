import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Whether the person viewing a public store page is signed in to AwaazOS as
 * active staff of that store. The page then offers "Dashboard" in place of the
 * buyer "Sign in" pill: a seller checking their own store is already signed in,
 * just not as a buyer, and "Sign in" read as if their session were lost.
 *
 * The JWT session is decoded without a database read; only a signed-in user
 * costs one indexed `StaffMember` lookup, scoped to this vendor. It returns a
 * boolean and nothing else, so it never widens what the public page renders.
 * Any failure is treated as "not staff": the public page must not break.
 */
export async function viewerIsStoreStaff(vendorId: string): Promise<boolean> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return false;
    const staff = await prisma.staffMember.findFirst({
      where: { vendorId, userId, isActive: true },
      select: { id: true },
    });
    return staff !== null;
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "storefront_staff_lookup_failed",
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
    return false;
  }
}
