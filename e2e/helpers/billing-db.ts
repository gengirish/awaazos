import { PrismaClient, type Plan, type StaffRole, type UserRole } from "@prisma/client";

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
 * Give a store placeholder Razorpay keys, so its order page offers "Pay online"
 * without calling Razorpay (saving through the API validates them against it).
 * Nothing decrypts them unless a real start call runs, so specs mock that call.
 */
export async function setRazorpayKeysBySlug(slug: string): Promise<void> {
  const res = await db().vendorSettings.updateMany({
    where: { vendor: { slug } },
    data: { razorpayKeyId: "rzp_test_e2e", razorpayKeySecretEnc: "e2e", razorpayWebhookSecretEnc: "e2e" },
  });
  if (res.count !== 1) {
    throw new Error(`setRazorpayKeysBySlug: expected 1 store for the slug, got ${res.count}`);
  }
}

/** What verify or the webhook leaves behind when Razorpay has taken the money (no real Razorpay here). */
export async function markPaidOnlineByOrderId(orderId: string): Promise<void> {
  const res = await db().transaction.updateMany({
    where: { id: orderId, paymentStatus: "PENDING" },
    data: {
      paymentStatus: "PAID",
      paidAt: new Date(),
      fulfilmentStatus: "CONFIRMED",
      razorpayOrderId: "order_e2e",
      razorpayPaymentId: "pay_e2e",
    },
  });
  if (res.count !== 1) {
    throw new Error(`markPaidOnlineByOrderId: expected 1 unpaid order, got ${res.count}`);
  }
}

/**
 * Change the role of the staff member registered with `email`. Registration
 * only ever creates an OWNER and there is no staff-invite flow yet, so this is
 * the one way a spec can see the app as a CASHIER or MANAGER. Same guard as
 * above: local throwaway database only (`CAN_SET_BILLING`).
 */
/** Delivered orders with these ratings, so a spec needn't place each one through the store. */
export async function addRatedOrders(vendorId: string, ratings: readonly number[]): Promise<void> {
  for (const rating of ratings) {
    await db().orderFeedback.create({
      data: {
        rating,
        vendor: { connect: { id: vendorId } },
        transaction: {
          create: {
            vendor: { connect: { id: vendorId } },
            billNumber: `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            subtotalPaise: 7_500,
            totalPaise: 7_500,
            paymentMethod: "CASH",
            source: "STOREFRONT",
            fulfilmentStatus: "DELIVERED",
          },
        },
      },
    });
  }
}

export async function setStaffRole(email: string, role: StaffRole): Promise<void> {
  const res = await db().staffMember.updateMany({ where: { user: { email } }, data: { role } });
  if (res.count !== 1) {
    throw new Error(`setStaffRole: expected 1 staff row for the e2e email, got ${res.count}`);
  }
}

/**
 * Give the user registered with `email` a platform role. Nothing in the app
 * grants one (it is set by hand in the database), so this is the only way a
 * spec can reach /admin/*. Same guard: local throwaway database only.
 */
export async function setPlatformRole(email: string, role: UserRole): Promise<void> {
  const res = await db().user.updateMany({ where: { email }, data: { role } });
  if (res.count !== 1) {
    throw new Error(`setPlatformRole: expected 1 user for the e2e email, got ${res.count}`);
  }
}

/** A vendor from before the trial existed: FREE tier, never locked. */
export function makeGrandfatheredFree(email: string): Promise<void> {
  return setVendorBilling(email, { plan: "FREE", planExpiresAt: null, trialEndsAt: null });
}

/** Referral columns of the vendor registered with `email` (local databases only). */
export async function getVendorReferral(
  email: string,
): Promise<{ id: string; referredByVendorId: string | null; trialEndsAt: Date | null }> {
  return db().vendor.findFirstOrThrow({
    where: { email },
    select: { id: true, referredByVendorId: true, trialEndsAt: true },
  });
}

/** Put a storefront order in a state only a real Razorpay payment reaches. Same guard. */
export async function setOrderPayment(
  orderId: string,
  data: {
    paymentStatus?: "PAID" | "PENDING";
    fulfilmentStatus?: "CONFIRMED" | "CANCELLED";
    razorpayPaymentId?: string | null;
    paymentIssue?: "paid_after_cancel" | "paid_late_oversold" | "paid_twice" | null;
    paymentIssuePaymentId?: string | null;
  },
): Promise<void> {
  const res = await db().transaction.updateMany({ where: { id: orderId }, data });
  if (res.count !== 1) throw new Error(`setOrderPayment: no order ${orderId}`);
}
