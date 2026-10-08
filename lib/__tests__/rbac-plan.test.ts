import type { Plan } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    staffMember: { findMany: vi.fn() },
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
  })),
}));

import { auth } from "@/lib/auth";
import { PLAN_RANK } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PlanGateError, requirePlan, requireVendorRole } from "@/lib/rbac";

describe("requirePlan", () => {
  it("throws PlanGateError with status 402 when plan is too low", () => {
    try {
      requirePlan({ plan: "FREE" }, "STARTER");
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(PlanGateError);
      expect((e as PlanGateError).status).toBe(402);
      expect((e as PlanGateError).required).toBe("STARTER");
      expect((e as PlanGateError).current).toBe("FREE");
    }
  });

  it("does not throw when plan satisfies minimum", () => {
    expect(() => requirePlan({ plan: "PRO" }, "STARTER")).not.toThrow();
  });
});

describe("PLAN_RANK", () => {
  it("orders plans from lowest to highest", () => {
    const ordered: Plan[] = ["FREE", "STARTER", "PRO", "ENTERPRISE"];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(PLAN_RANK[ordered[i]!]).toBeLessThan(PLAN_RANK[ordered[i + 1]!]!);
    }
  });
});

describe("requireVendorRole applies plan expiry", () => {
  function mockMembership(plan: Plan, planExpiresAt: Date | null) {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1", passwordChangedAt: null } as never);
    vi.mocked(prisma.staffMember.findMany).mockResolvedValue([
      {
        vendorId: "v1",
        role: "OWNER",
        vendor: { id: "v1", slug: "v1-shop", plan, planExpiresAt },
      },
    ] as never);
  }

  it("downgrades an expired paid plan to FREE but keeps the stored plan and raw expiry", async () => {
    const expiredAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    mockMembership("PRO", expiredAt);
    const ctx = await requireVendorRole("CASHIER");
    expect(ctx.vendor.plan).toBe("FREE");
    expect(ctx.storedPlan).toBe("PRO");
    expect(ctx.vendor.planExpiresAt).toEqual(expiredAt);
    expect(() => requirePlan(ctx.vendor, "STARTER")).toThrow(PlanGateError);
  });

  it("leaves an unexpired plan alone", async () => {
    mockMembership("PRO", new Date(Date.now() + 24 * 60 * 60 * 1000));
    const ctx = await requireVendorRole("CASHIER");
    expect(ctx.vendor.plan).toBe("PRO");
    expect(ctx.storedPlan).toBe("PRO");
  });
});
