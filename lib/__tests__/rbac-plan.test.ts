import type { Plan } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
  })),
}));

import { PLAN_RANK } from "@/lib/constants";
import { PlanGateError, requirePlan } from "@/lib/rbac";

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
