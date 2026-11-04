/**
 * Owner survey, store price and the custom Razorpay plan — DB integration test.
 * Runs only with DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production);
 * see lib/__tests__/drops.db.test.ts for the recipe, or `npm run test:drops:db`.
 *
 * Every write is real. The session and Razorpay's plan API are stubbed.
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

const h = vi.hoisted(() => ({
  platformRole: null as null | "USER" | "ADMIN" | "SUPER_ADMIN",
  /** The store and role `requireVendorRole` resolves; null = signed out. */
  session: null as null | { vendor: { id: string; isDemo: boolean }; role: "CASHIER" | "MANAGER" | "OWNER" },
  createRazorpayPlan: vi.fn(),
}));

vi.mock("@/lib/rbac", () => {
  class AuthError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  const PLATFORM = { USER: 0, ADMIN: 1, SUPER_ADMIN: 2 };
  const STAFF = { CASHIER: 0, MANAGER: 1, OWNER: 2 };
  return {
    AuthError,
    requirePlatformRole: vi.fn(async (required: keyof typeof PLATFORM) => {
      if (!h.platformRole) throw new AuthError(401, "Unauthorized");
      if (PLATFORM[h.platformRole] < PLATFORM[required]) throw new AuthError(403, "Forbidden");
      return { user: { id: "admin-user-db-test", role: h.platformRole } };
    }),
    requireVendorRole: vi.fn(async (min: keyof typeof STAFF) => {
      if (!h.session) throw new AuthError(401, "Unauthorized");
      if (STAFF[h.session.role] < STAFF[min]) throw new AuthError(403, "Forbidden");
      return { vendor: h.session.vendor, staff: { role: h.session.role }, setVendorCookie: null };
    }),
  };
});

vi.mock("@/lib/razorpay", () => ({
  createRazorpayPlan: h.createRazorpayPlan,
  getRazorpayPlanId: (_plan: string, interval: string) => `plan_list_${interval}`,
}));

const ANSWERS = {
  pains: ["payment_matching", "delivery"],
  topPain: "delivery",
  weeklyOrders: "10_30",
  maxWeeklyOrders: "30_80",
  willingToPay: "199_499",
  comment: "Rider tracking",
};

describe.skipIf(!ENABLED)("owner survey and store price — DB integration", () => {
  let prisma: PrismaClient;
  let surveyRoute: typeof import("@/app/api/vendor/survey/route");
  let priceRoute: typeof import("@/app/api/admin/vendors/[id]/price/route");
  let resolveSubscriptionPlanId: typeof import("@/lib/custom-subscription-plan").resolveSubscriptionPlanId;
  let shouldAskOwnerSurvey: typeof import("@/lib/owner-survey-server").shouldAskOwnerSurvey;
  const vendorIds: string[] = [];
  // Well away from any price another test might use, and unique to this run.
  const testBase = 2000 + (randomBytes(2).readUInt16BE(0) % 2900);
  const testPricePaise = testBase * 100;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // Belt and braces: this test writes rows. Refuse anything that isn't local.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("owner-survey.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.AUTH_SECRET ??= "db-test-auth-secret";
    ({ prisma } = await import("@/lib/prisma"));
    surveyRoute = await import("@/app/api/vendor/survey/route");
    priceRoute = await import("@/app/api/admin/vendors/[id]/price/route");
    ({ resolveSubscriptionPlanId } = await import("@/lib/custom-subscription-plan"));
    ({ shouldAskOwnerSurvey } = await import("@/lib/owner-survey-server"));
  });

  afterAll(async () => {
    if (!prisma) return;
    if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.customRazorpayPlan.deleteMany({ where: { razorpayPlanId: { startsWith: "plan_dbtest_" } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    h.platformRole = "SUPER_ADMIN";
    h.session = null;
    h.createRazorpayPlan.mockReset();
  });

  async function seed(data: { isDemo?: boolean; customPricePaise?: number } = {}) {
    const tag = randomBytes(5).toString("hex");
    const v = await prisma.vendor.create({
      data: {
        slug: `owner-survey-test-${tag}`,
        name: `Owner Survey Test ${tag}`,
        ownerName: "Test Owner",
        phone: "+919876543210",
        email: `owner-${tag}@example.com`,
        ...data,
      },
    });
    vendorIds.push(v.id);
    return v;
  }

  function putSurvey(body: unknown) {
    return surveyRoute.PUT(
      new NextRequest("http://localhost/api/vendor/survey", {
        method: "PUT",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );
  }

  function patchPrice(vendorId: string, body: unknown) {
    return priceRoute.PATCH(
      new NextRequest(`http://localhost/api/admin/vendors/${vendorId}/price`, {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: vendorId }) },
    );
  }

  describe("PUT /api/vendor/survey", () => {
    it("saves one row per store, replaces it on a second answer and stops asking", async () => {
      const v = await seed();
      h.session = { vendor: { id: v.id, isDemo: false }, role: "OWNER" };
      expect(await shouldAskOwnerSurvey({ id: v.id, isDemo: false }, "OWNER")).toBe(true);

      expect((await putSurvey(ANSWERS)).status).toBe(200);
      expect((await putSurvey({ ...ANSWERS, pains: ["profit"], topPain: "profit", comment: "" })).status).toBe(200);

      const rows = await prisma.ownerSurveyResponse.findMany({ where: { vendorId: v.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ pains: ["profit"], topPain: "profit", comment: null });
      expect(await shouldAskOwnerSurvey({ id: v.id, isDemo: false }, "OWNER")).toBe(false);
    });

    it("writes only to the signed-in store", async () => {
      const [mine, other] = await Promise.all([seed(), seed()]);
      h.session = { vendor: { id: mine.id, isDemo: false }, role: "OWNER" };
      await putSurvey({ ...ANSWERS, vendorId: other.id });
      expect(await prisma.ownerSurveyResponse.count({ where: { vendorId: other.id } })).toBe(0);
      expect(await prisma.ownerSurveyResponse.count({ where: { vendorId: mine.id } })).toBe(1);
    });

    it("refuses staff, demo stores and bad answers", async () => {
      const v = await seed();
      h.session = { vendor: { id: v.id, isDemo: false }, role: "MANAGER" };
      expect((await putSurvey(ANSWERS)).status).toBe(403);

      const demo = await seed({ isDemo: true });
      h.session = { vendor: { id: demo.id, isDemo: true }, role: "OWNER" };
      expect((await putSurvey(ANSWERS)).status).toBe(404);
      expect(await shouldAskOwnerSurvey({ id: demo.id, isDemo: true }, "OWNER")).toBe(false);

      h.session = { vendor: { id: v.id, isDemo: false }, role: "OWNER" };
      expect((await putSurvey({ ...ANSWERS, topPain: "profit" })).status).toBe(400);
      expect(await prisma.ownerSurveyResponse.count({ where: { vendorId: v.id } })).toBe(0);
    });

    it("asks only an owner", async () => {
      const v = await seed();
      expect(await shouldAskOwnerSurvey({ id: v.id, isDemo: false }, "MANAGER")).toBe(false);
    });
  });

  describe("PATCH /api/admin/vendors/[id]/price", () => {
    it("sets a price in paise and clears it, touching nothing else", async () => {
      const v = await seed();
      const res = await patchPrice(v.id, { monthlyRupees: 199 });
      expect(res.status).toBe(200);
      const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
      expect(row.customPricePaise).toBe(19900);
      expect(row.plan).toBe(v.plan);
      expect(row.trialEndsAt).toEqual(v.trialEndsAt);

      expect((await patchPrice(v.id, { monthlyRupees: null })).status).toBe(200);
      expect((await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).customPricePaise).toBeNull();
    });

    it("rejects a price out of range or with paise", async () => {
      const v = await seed();
      for (const monthlyRupees of [48, 5000, 199.5]) {
        expect((await patchPrice(v.id, { monthlyRupees })).status).toBe(400);
      }
      expect((await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).customPricePaise).toBeNull();
    });

    it("answers 404 to everyone but a SUPER_ADMIN, and for an unknown store", async () => {
      const v = await seed();
      for (const role of [null, "USER", "ADMIN"] as const) {
        h.platformRole = role;
        expect((await patchPrice(v.id, { monthlyRupees: 199 })).status).toBe(404);
      }
      expect((await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).customPricePaise).toBeNull();
      h.platformRole = "SUPER_ADMIN";
      expect((await patchPrice("no-such-vendor", { monthlyRupees: 199 })).status).toBe(404);
    });
  });

  describe("resolveSubscriptionPlanId", () => {
    const input = (customPricePaise: number | null, interval: "monthly" | "yearly" = "monthly") => ({
      plan: "STARTER" as const,
      interval,
      customPricePaise,
    });

    it("uses the list plan without a custom price, and creates nothing", async () => {
      expect(await resolveSubscriptionPlanId(input(null, "yearly"))).toBe("plan_list_yearly");
      expect(h.createRazorpayPlan).not.toHaveBeenCalled();
    });

    it("creates one Razorpay plan per price and interval, then reuses it", async () => {
      h.createRazorpayPlan.mockResolvedValueOnce("plan_dbtest_m").mockResolvedValueOnce("plan_dbtest_y");

      expect(await resolveSubscriptionPlanId(input(testPricePaise))).toBe("plan_dbtest_m");
      expect(await resolveSubscriptionPlanId(input(testPricePaise))).toBe("plan_dbtest_m");
      expect(h.createRazorpayPlan).toHaveBeenCalledTimes(1);
      expect(h.createRazorpayPlan).toHaveBeenCalledWith({
        plan: "STARTER",
        interval: "monthly",
        basePaise: testPricePaise,
        amountPaise: testPricePaise + Math.floor((testPricePaise * 1800) / 10_000),
      });

      expect(await resolveSubscriptionPlanId(input(testPricePaise, "yearly"))).toBe("plan_dbtest_y");
      expect(h.createRazorpayPlan).toHaveBeenCalledTimes(2);
      expect(h.createRazorpayPlan.mock.calls[1]![0].basePaise).toBe(testPricePaise * 10);
    });

    it("settles a race on the plan that was stored first", async () => {
      const price = testPricePaise + 100;
      h.createRazorpayPlan.mockImplementation(async () => {
        // Another owner at this price finishes while Razorpay answers this one.
        await prisma.customRazorpayPlan.create({
          data: { basePaise: price, interval: "monthly", razorpayPlanId: "plan_dbtest_winner" },
        });
        return "plan_dbtest_loser";
      });
      expect(await resolveSubscriptionPlanId(input(price))).toBe("plan_dbtest_winner");
    });
  });
});
