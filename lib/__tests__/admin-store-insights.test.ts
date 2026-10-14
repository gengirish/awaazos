import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { countDemoStages, demoStage } from "@/lib/admin-demo-stores";
import { describeLastOrder } from "@/lib/admin-store-health";

// 14/10/2026 12:00 IST
const NOW = new Date("2026-10-14T06:30:00Z");
const DAY = 86_400_000;

describe("describeLastOrder", () => {
  it("says so when there is no order", () => {
    expect(describeLastOrder(null, NOW)).toBe("No orders yet");
  });

  it("counts IST calendar days, not 24-hour spans", () => {
    expect(describeLastOrder(new Date("2026-10-13T18:31:00Z"), NOW)).toBe("Today"); // 00:01 IST today
    expect(describeLastOrder(new Date("2026-10-13T18:20:00Z"), NOW)).toBe("Yesterday"); // 23:50 IST yesterday
    expect(describeLastOrder(new Date("2026-10-09T05:00:00Z"), NOW)).toBe("5 days ago");
  });

  it("treats a clock-skewed future order as today", () => {
    expect(describeLastOrder(new Date(NOW.getTime() + 60_000), NOW)).toBe("Today");
  });
});

describe("demoStage", () => {
  const h = (createdDaysAgo: number, expiresInDays: number, usedDaysAgo: number | null = null) => ({
    createdAt: new Date(NOW.getTime() - createdDaysAgo * DAY),
    expiresAt: new Date(NOW.getTime() + expiresInDays * DAY),
    usedAt: usedDaysAgo === null ? null : new Date(NOW.getTime() - usedDaysAgo * DAY),
  });

  it("is built when no invite was made", () => {
    expect(demoStage({ isDemo: true, demoHandovers: [] }, NOW)).toEqual({ kind: "built" });
  });

  it("is invited while an unused link is still valid", () => {
    const live = h(1, 6);
    expect(demoStage({ isDemo: true, demoHandovers: [h(5, -1), live] }, NOW)).toEqual({
      kind: "invited",
      sentAt: live.createdAt,
      expiresAt: live.expiresAt,
    });
  });

  it("reports the newest invite once all have expired", () => {
    const newest = h(3, -1);
    expect(demoStage({ isDemo: true, demoHandovers: [h(9, -7), newest] }, NOW)).toEqual({
      kind: "invite_expired",
      sentAt: newest.createdAt,
      expiredAt: newest.expiresAt,
    });
  });

  it("is claimed once the store is no longer a demo, dated by the used link", () => {
    const used = h(4, 3, 2);
    expect(demoStage({ isDemo: false, demoHandovers: [used] }, NOW)).toEqual({
      kind: "claimed",
      claimedAt: used.usedAt,
    });
    expect(demoStage({ isDemo: false, demoHandovers: [] }, NOW)).toEqual({ kind: "claimed", claimedAt: null });
  });

  it("counts every stage", () => {
    const stages = [
      demoStage({ isDemo: true, demoHandovers: [] }, NOW),
      demoStage({ isDemo: true, demoHandovers: [h(1, 6)] }, NOW),
      demoStage({ isDemo: false, demoHandovers: [] }, NOW),
      demoStage({ isDemo: false, demoHandovers: [] }, NOW),
    ];
    expect(countDemoStages(stages)).toEqual({ built: 1, invited: 1, invite_expired: 0, claimed: 2 });
  });
});
