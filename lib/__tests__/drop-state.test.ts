import { describe, expect, it } from "vitest";

import { dropStateKind, dropStateLabel } from "@/lib/drop-state";
import { istToUtc } from "@/lib/drops-time";

// Thu 5 Nov 2026, 10:00 IST.
const NOW = istToUtc("2026-11-05", "10:00");
const CUTOFF_AHEAD = istToUtc("2026-11-06", "21:00"); // Fri 9 pm
const CUTOFF_PASSED = istToUtc("2026-11-04", "21:00"); // Wed 9 pm

describe("dropStateLabel", () => {
  it("not yet open → when it opens", () => {
    const drop = { status: "OPEN" as const, opensAt: istToUtc("2026-11-06", "18:00"), closesAt: CUTOFF_AHEAD };
    expect(dropStateKind(drop, NOW)).toBe("scheduled");
    expect(dropStateLabel(drop, NOW)).toBe("Opens tomorrow 6:00 pm");
  });

  it("cut-off passed → names the cut-off", () => {
    const drop = { status: "OPEN" as const, opensAt: null, closesAt: istToUtc("2026-11-05", "09:00") };
    expect(dropStateKind(drop, NOW)).toBe("cutoff_passed");
    expect(dropStateLabel(drop, NOW)).toBe("Cut-off passed (today 9:00 am)");
  });

  it("a stored close after the cut-off is still a cut-off", () => {
    const drop = { status: "CLOSED" as const, opensAt: null, closesAt: CUTOFF_PASSED };
    expect(dropStateKind(drop, NOW)).toBe("cutoff_passed");
  });

  it("sold out → Sold out", () => {
    const drop = { status: "OPEN" as const, opensAt: null, closesAt: CUTOFF_AHEAD };
    expect(dropStateLabel(drop, NOW, { soldOut: true })).toBe("Sold out");
  });

  it("closed before its cut-off → closed by the seller, worded for each side", () => {
    const drop = { status: "CLOSED" as const, opensAt: null, closesAt: CUTOFF_AHEAD };
    expect(dropStateKind(drop, NOW)).toBe("closed_by_seller");
    expect(dropStateLabel(drop, NOW)).toBe("Closed by you");
    expect(dropStateLabel(drop, NOW, { viewer: "buyer" })).toBe("Closed by the store");
  });

  it("open → Taking orders", () => {
    expect(dropStateLabel({ status: "OPEN", opensAt: null, closesAt: CUTOFF_AHEAD }, NOW)).toBe("Taking orders");
  });

  it("draft → not open yet", () => {
    expect(dropStateLabel({ status: "DRAFT", opensAt: null, closesAt: CUTOFF_AHEAD }, NOW)).toBe(
      "Draft · not open yet",
    );
  });

  it("never says a bare Orders closed", () => {
    const statuses = ["DRAFT", "OPEN", "CLOSED", "FROZEN", "FULFILLED"] as const;
    for (const status of statuses) {
      for (const closesAt of [CUTOFF_AHEAD, CUTOFF_PASSED]) {
        for (const soldOut of [false, true]) {
          expect(dropStateLabel({ status, opensAt: null, closesAt }, NOW, { soldOut })).not.toBe("Orders closed");
        }
      }
    }
  });
});
