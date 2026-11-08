import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAmount: vi.fn(),
  getPlanId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/razorpay", () => ({
  createRazorpayPlan: vi.fn(),
  fetchRazorpayPlanAmountPaise: mocks.fetchAmount,
  getRazorpayPlanId: mocks.getPlanId,
}));

import { resolveSubscriptionPlanId } from "@/lib/custom-subscription-plan";
import { subscriptionChargePaise } from "@/lib/subscription";

const STARTER_MONTHLY = { plan: "STARTER", interval: "monthly", customPricePaise: null } as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPlanId.mockReturnValue("plan_list");
});

describe("a list plan must charge what the page says", () => {
  it("returns the plan when Razorpay's amount matches the price", async () => {
    mocks.fetchAmount.mockResolvedValue(subscriptionChargePaise("STARTER", "monthly"));
    await expect(resolveSubscriptionPlanId(STARTER_MONTHLY)).resolves.toBe("plan_list");
    expect(mocks.fetchAmount).toHaveBeenCalledWith("plan_list");
  });

  it("refuses an env id left on a plan at another amount", async () => {
    mocks.fetchAmount.mockResolvedValue(35282);
    await expect(resolveSubscriptionPlanId(STARTER_MONTHLY)).rejects.toThrow(/charges 35282/);
  });
});
