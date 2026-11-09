import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type HeartbeatBill,
  type HeartbeatSellerInput,
  HEARTBEAT_BADGES,
  SPARK_DAYS,
  buildHeartbeat,
  countByBadge,
  fillNudgeTemplate,
  heartbeatBadge,
  istDayNumber,
  nudgeTemplateKey,
  parseBadgeFilter,
} from "@/lib/seller-heartbeat";

/** 09/11/2026 10:30 IST. The sparkline covers 26/10 to 08/11. */
const NOW = new Date("2026-11-09T05:00:00.000Z");
const DAY = 86_400_000;
/** 00:00 IST, `n` days before today (09/11). */
const istMidnight = (n: number) => new Date(new Date("2026-11-08T18:30:00.000Z").getTime() - n * DAY);
/** Noon IST, `n` days before today. */
const noon = (n: number) => new Date(istMidnight(n).getTime() + 12 * 3_600_000);

function seller(id: string, over: Partial<HeartbeatSellerInput> = {}): HeartbeatSellerInput {
  return {
    id,
    name: `Store ${id}`,
    slug: id,
    createdAt: noon(60),
    lastPaidAt: null,
    ownerName: "Asha Rao",
    phone: null,
    ...over,
  };
}

const bill = (vendorId: string, paidAt: Date, totalPaise = 10_000, source = "MANUAL"): HeartbeatBill => ({
  vendorId,
  paidAt,
  totalPaise,
  source,
});

describe("istDayNumber", () => {
  it("splits days at IST midnight, not UTC midnight", () => {
    expect(istDayNumber(new Date("2026-11-08T18:29:59.999Z"))).toBe(istDayNumber(new Date("2026-11-08T00:00:00Z")));
    expect(istDayNumber(new Date("2026-11-08T18:30:00.000Z"))).toBe(istDayNumber(NOW));
  });
});

describe("heartbeatBadge", () => {
  const base = { ageDays: 30, bills7d: 3, billsPrior7d: 3 };

  it("calls a store under 14 days old New, even when idle", () => {
    expect(heartbeatBadge({ ...base, ageDays: 13, daysIdle: null })).toBe("new");
    expect(heartbeatBadge({ ...base, ageDays: 14, daysIdle: null })).toBe("at_risk");
  });

  it("grades idle days: <3 Healthy, 3–6 Watch, ≥7 or never At risk", () => {
    expect(heartbeatBadge({ ...base, daysIdle: 0 })).toBe("healthy");
    expect(heartbeatBadge({ ...base, daysIdle: 2 })).toBe("healthy");
    expect(heartbeatBadge({ ...base, daysIdle: 3 })).toBe("watch");
    expect(heartbeatBadge({ ...base, daysIdle: 6 })).toBe("watch");
    expect(heartbeatBadge({ ...base, daysIdle: 7 })).toBe("at_risk");
    expect(heartbeatBadge({ ...base, daysIdle: null })).toBe("at_risk");
  });

  it("flags a ≥ 50% drop from a week of at least 4 bills", () => {
    expect(heartbeatBadge({ ageDays: 30, daysIdle: 0, bills7d: 2, billsPrior7d: 4 })).toBe("at_risk");
    expect(heartbeatBadge({ ageDays: 30, daysIdle: 0, bills7d: 3, billsPrior7d: 4 })).toBe("healthy");
    // 2 → 1 is a 50% drop on a base too small to mean anything.
    expect(heartbeatBadge({ ageDays: 30, daysIdle: 0, bills7d: 1, billsPrior7d: 3 })).toBe("healthy");
  });
});

describe("buildHeartbeat", () => {
  it("returns nothing for a platform with no sellers", () => {
    expect(buildHeartbeat([], [bill("ghost", noon(1))], NOW)).toEqual([]);
  });

  it("buckets one seller's bills by IST day and keeps today out of the 14 days", () => {
    const rows = buildHeartbeat(
      [seller("a", { lastPaidAt: noon(0) })],
      [
        bill("a", istMidnight(14)), // 26/10 00:00 IST: first instant, index 0
        bill("a", new Date(istMidnight(1).getTime() - 1)), // 07/11 23:59:59.999 IST: index 12
        bill("a", istMidnight(1), 25_000, "VOICE"), // 08/11 00:00 IST: index 13
        bill("a", noon(1), 15_000),
        bill("a", noon(0)), // today: not in the sparkline or the 7 days
        bill("a", new Date(istMidnight(14).getTime() - 1)), // 25/10: before the window
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.spark).toHaveLength(SPARK_DAYS);
    expect(row.spark[0]).toBe(1);
    expect(row.spark[12]).toBe(1);
    expect(row.spark[13]).toBe(2);
    expect(row.spark.reduce((a, b) => a + b, 0)).toBe(4);
    expect(row.bills7d).toBe(3); // 07/11 and twice on 08/11
    expect(row.billsPrior7d).toBe(1);
    expect(row.gmv7dPaise).toBe(50_000);
    expect(row.voiceShare7d).toBeCloseTo(1 / 3);
    expect(row.daysIdle).toBe(0);
    expect(row.badge).toBe("healthy");
  });

  it("counts idle days in IST calendar days and gives no voice share without bills", () => {
    const [row] = buildHeartbeat([seller("a", { lastPaidAt: new Date(istMidnight(3).getTime() - 1) })], [], NOW);
    // Last paid 05/11 23:59 IST; today 09/11 → 4 days.
    expect(row.daysIdle).toBe(4);
    expect(row.badge).toBe("watch");
    expect(row.voiceShare7d).toBeNull();
    expect(row.spark.every((v) => v === 0)).toBe(true);
  });

  it("sorts 50 sellers riskiest first and counts every badge", () => {
    const sellers: HeartbeatSellerInput[] = Array.from({ length: 50 }, (_, i) => {
      const kind = i % 5;
      if (kind === 0) return seller(`s${i}`, { lastPaidAt: null }); // never paid: at risk
      if (kind === 1) return seller(`s${i}`, { lastPaidAt: noon(9 + i) }); // long idle: at risk
      if (kind === 2) return seller(`s${i}`, { lastPaidAt: noon(4) }); // watch
      if (kind === 3) return seller(`s${i}`, { createdAt: noon(2), lastPaidAt: null }); // new
      return seller(`s${i}`, { lastPaidAt: noon(0) }); // healthy
    });
    const rows = buildHeartbeat(sellers, [], NOW);

    expect(rows).toHaveLength(50);
    expect(countByBadge(rows)).toEqual({ at_risk: 20, watch: 10, new: 10, healthy: 10 });
    const order = rows.map((r) => r.badge);
    const rank = (b: string) => HEARTBEAT_BADGES.indexOf(b as (typeof HEARTBEAT_BADGES)[number]);
    expect(order.every((b, i) => i === 0 || rank(order[i - 1]) <= rank(b))).toBe(true);
    // Within At risk: never paid first, then the longest idle.
    expect(rows.slice(0, 10).every((r) => r.daysIdle === null)).toBe(true);
    expect(rows[10].daysIdle).toBeGreaterThan(rows[19].daysIdle!);
  });
});

describe("parseBadgeFilter", () => {
  it("accepts a known badge and ignores anything else", () => {
    expect(parseBadgeFilter("at_risk")).toBe("at_risk");
    expect(parseBadgeFilter(["watch", "new"])).toBe("watch");
    expect(parseBadgeFilter("everyone")).toBeNull();
    expect(parseBadgeFilter(undefined)).toBeNull();
  });
});

describe("nudge copy", () => {
  const vars = { firstName: "Asha Rao", senderName: "Girish Hiremath", storeName: "Asha's Bakes", storeUrl: "https://x.test/s/asha", daysIdle: 9 };

  it("picks the never-paid message for an At risk store with no paid bill", () => {
    expect(nudgeTemplateKey({ badge: "at_risk", daysIdle: null })).toBe("never-paid");
    expect(nudgeTemplateKey({ badge: "at_risk", daysIdle: 8 })).toBe("at-risk");
    expect(nudgeTemplateKey({ badge: "watch", daysIdle: 4 })).toBe("watch");
  });

  it("fills every variable, and drops a missing first name with its space", () => {
    const t = "Hi {firstName}, {senderName} here. {storeName}: {daysIdle} days. {storeUrl} {typo}";
    expect(fillNudgeTemplate(t, vars)).toBe("Hi Asha, Girish here. Asha's Bakes: 9 days. https://x.test/s/asha {typo}");
    expect(fillNudgeTemplate("Hi {firstName},", { ...vars, firstName: null })).toBe("Hi,");
  });

  it("ships a template file for every case, using only known variables", () => {
    const dir = path.join(process.cwd(), "content", "admin-nudges");
    for (const key of ["at-risk", "never-paid", "watch", "new", "healthy"]) {
      const text = readFileSync(path.join(dir, `${key}.txt`), "utf8");
      const filled = fillNudgeTemplate(text, vars);
      expect(filled, key).not.toMatch(/\{\w+\}/);
      expect(filled.length, key).toBeGreaterThan(20);
    }
  });
});
