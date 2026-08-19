import type { Plan, StaffRole, UserRole, Vendor } from "@prisma/client";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { auth } from "@/lib/auth";
import { PLAN_RANK } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

const USER_ROLE_RANK: Record<UserRole, number> = {
  USER: 0,
  ADMIN: 1,
  SUPER_ADMIN: 2,
};

/** Business hierarchy: CASHIER < MANAGER < OWNER */
const STAFF_ROLE_RANK: Record<StaffRole, number> = {
  CASHIER: 0,
  MANAGER: 1,
  OWNER: 2,
};

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class PlanGateError extends AuthError {
  constructor(
    public readonly required: Plan,
    public readonly current: Plan,
  ) {
    super(402, "Plan upgrade required");
    this.name = "PlanGateError";
  }
}

export function userRoleAtLeast(actual: UserRole, required: UserRole): boolean {
  return USER_ROLE_RANK[actual] >= USER_ROLE_RANK[required];
}

export function staffRoleAtLeast(actual: StaffRole, required: StaffRole): boolean {
  return STAFF_ROLE_RANK[actual] >= STAFF_ROLE_RANK[required];
}

export function requirePlan(vendor: { plan: Plan }, minPlan: Plan): void {
  if (PLAN_RANK[vendor.plan] < PLAN_RANK[minPlan]) {
    throw new PlanGateError(minPlan, vendor.plan);
  }
}

/**
 * Reject a session that was minted before the account's last password change.
 *
 * Auth.js JWT sessions are stateless, so resetting a password cannot revoke an
 * already-issued token on its own. This is the enforcement half of
 * `User.passwordChangedAt`, which POST /api/auth/reset-password writes.
 *
 * It lives here rather than in the `jwt` callback because that callback is in
 * lib/auth.config.ts, which must stay edge-safe (no Prisma) — see
 * .cursor/rules/auth-rbac.mdc. Every protected route already funnels through
 * these two guards, so this is the natural chokepoint.
 *
 * Fail-safe: only rejects when BOTH timestamps are present, so accounts that
 * have never reset a password are never locked out.
 */
function assertSessionNotStale(
  user: { passwordChangedAt: Date | null },
  tokenIssuedAt: number | undefined,
): void {
  if (!user.passwordChangedAt || typeof tokenIssuedAt !== "number") return;
  // `iat` is seconds since epoch; allow 5s of clock skew between issuer and reader.
  if (tokenIssuedAt * 1000 + 5_000 < user.passwordChangedAt.getTime()) {
    throw new AuthError(401, "Session expired. Please sign in again.");
  }
}
export async function requirePlatformRole(role: UserRole): Promise<{ user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>> }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthError(401, "Unauthorized");
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    throw new AuthError(401, "Unauthorized");
  }
  assertSessionNotStale(user, session.user.tokenIssuedAt);
  if (!userRoleAtLeast(user.role, role)) {
    throw new AuthError(403, `Requires platform role ${role}.`);
  }
  return { user };
}

export type VendorRoleContext = {
  user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;
  vendor: Vendor;
  staff: NonNullable<Awaited<ReturnType<typeof prisma.staffMember.findFirst>>>;
  /** When non-null, API route should `Set-Cookie: awz_vendor=...` */
  setVendorCookie: string | null;
};

export async function requireVendorRole(
  minRole: StaffRole,
  vendorIdOrSlug?: string | null,
  req?: NextRequest,
): Promise<VendorRoleContext> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthError(401, "Unauthorized");
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    throw new AuthError(401, "Unauthorized");
  }
  assertSessionNotStale(user, session.user.tokenIssuedAt);

  const memberships = await prisma.staffMember.findMany({
    where: { userId: user.id, isActive: true },
    include: { vendor: true },
    orderBy: { createdAt: "asc" },
  });

  if (!memberships.length) {
    throw new AuthError(403, "No vendor membership.");
  }

  const cookieStore = await cookies();
  const cookieSlug = cookieStore.get("awz_vendor")?.value;
  const querySlug = req?.nextUrl.searchParams.get("vendor") ?? undefined;

  const target = vendorIdOrSlug ?? querySlug ?? cookieSlug;

  let staff = target
    ? memberships.find((m) => m.vendor.slug === target || m.vendorId === target)
    : undefined;

  let usedDefaultFirst = false;
  if (!staff) {
    staff = memberships[0];
    usedDefaultFirst = true;
  }

  if (!staff) {
    throw new AuthError(403, "Vendor not found for this account.");
  }

  const { vendor } = staff;
  if (!staffRoleAtLeast(staff.role, minRole)) {
    throw new AuthError(403, `Requires staff role ${minRole} or higher.`);
  }

  const hadCookie = Boolean(cookieSlug);
  const setVendorCookie = usedDefaultFirst && !hadCookie ? vendor.slug : null;

  return { user, vendor, staff, setVendorCookie };
}
