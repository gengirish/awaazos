import { PrismaClient, type Plan, type StaffRole } from "@prisma/client";

/**
 * Billing state can't be reached through the app (a trial takes 30 days to
 * end), so these specs set it straight in the database the dev server uses.
 *
 * Only ever against a local throwaway Postgres: when DATABASE_URL isn't
 * localhost, or BASE_URL points at a deployment, `CAN_SET_BILLING` is false
 * and the specs that need it skip themselves.
 */
const url = process.env.DATABASE_URL ?? "";
const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

export const CAN_SET_BILLING =
  /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseUrl);

let client: PrismaClient | null = null;

function db(): PrismaClient {
  if (!CAN_SET_BILLING) {
    throw new Error("billing-db helper refuses to run against a non-local database or deployment");
  }
  client ??= new PrismaClient({ datasources: { db: { url } } });
  return client;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * DAY_MS);
}

/** Set the billing columns of the vendor registered with `email` (registerVendor's creds). */
export async function setVendorBilling(
  email: string,
  data: { trialEndsAt?: Date | null; plan?: Plan; planExpiresAt?: Date | null },
): Promise<void> {
  const res = await db().vendor.updateMany({ where: { email }, data });
  if (res.count !== 1) {
    throw new Error(`setVendorBilling: expected 1 vendor for the e2e email, got ${res.count}`);
  }
}

/**
 * Change the role of the staff member registered with `email`. Registration
 * only ever creates an OWNER and there is no staff-invite flow yet, so this is
 * the one way a spec can see the app as a CASHIER or MANAGER. Same guard as
 * above: local throwaway database only (`CAN_SET_BILLING`).
 */
export async function setStaffRole(email: string, role: StaffRole): Promise<void> {
  const res = await db().staffMember.updateMany({ where: { user: { email } }, data: { role } });
  if (res.count !== 1) {
    throw new Error(`setStaffRole: expected 1 staff row for the e2e email, got ${res.count}`);
  }
}

/** A vendor from before the trial existed: FREE tier, never locked. */
export function makeGrandfatheredFree(email: string): Promise<void> {
  return setVendorBilling(email, { plan: "FREE", planExpiresAt: null, trialEndsAt: null });
}
