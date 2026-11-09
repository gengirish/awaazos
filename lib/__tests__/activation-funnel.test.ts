import { describe, expect, it } from "vitest";

import { UNKNOWN_CITY, buildActivationFunnel, cityKey } from "@/lib/activation-funnel";

describe("cityKey", () => {
  it("groups spellings and old names together", () => {
    expect(cityKey(" Bengaluru ")).toBe("bengaluru");
    expect(cityKey("BANGALORE")).toBe("bengaluru");
    expect(cityKey("navi   mumbai")).toBe("navi mumbai");
    expect(cityKey("Secunderabad")).toBe("hyderabad");
    expect(cityKey("")).toBeNull();
    expect(cityKey(null)).toBeNull();
  });
});

describe("buildActivationFunnel", () => {
  it("is empty with no demo stores", () => {
    expect(buildActivationFunnel([])).toEqual({ rows: [], total: { city: "All cities", created: 0, claimed: 0, paid: 0 } });
  });

  it("counts by city, keeps each stage inside the one before and puts Unknown last", () => {
    const f = buildActivationFunnel([
      { vendorId: "a", city: "Bengaluru", claimed: true, paid: true },
      { vendorId: "b", city: "bangalore", claimed: true, paid: false },
      { vendorId: "c", city: "Bengaluru", claimed: false, paid: false },
      { vendorId: "d", city: "Hyderabad", claimed: false, paid: true }, // paid without a claim: not counted as paid
      { vendorId: "e", city: null, claimed: true, paid: true },
      { vendorId: "f", city: "navi mumbai", claimed: false, paid: false },
      { vendorId: "f", city: "navi mumbai", claimed: false, paid: false }, // the same store twice
    ]);
    expect(f.rows).toEqual([
      { city: "Bengaluru", created: 3, claimed: 2, paid: 1 },
      { city: "Hyderabad", created: 1, claimed: 0, paid: 0 },
      { city: "Navi Mumbai", created: 1, claimed: 0, paid: 0 },
      { city: UNKNOWN_CITY, created: 1, claimed: 1, paid: 1 },
    ]);
    expect(f.total).toEqual({ city: "All cities", created: 6, claimed: 3, paid: 2 });
  });
});
