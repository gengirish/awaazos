import { describe, expect, it } from "vitest";

import { showFssaiWarning } from "@/lib/fssai";

describe("showFssaiWarning", () => {
  it("warns a live food store with no number", () => {
    expect(showFssaiWarning({ kind: "food", publishStorefront: true, fssaiNumber: null })).toBe(true);
    expect(showFssaiWarning({ kind: "food", publishStorefront: true, fssaiNumber: "  " })).toBe(true);
  });
  it("is quiet when a number is saved, the store is not live, or it sells goods", () => {
    expect(showFssaiWarning({ kind: "food", publishStorefront: true, fssaiNumber: "12345678901234" })).toBe(false);
    expect(showFssaiWarning({ kind: "food", publishStorefront: false, fssaiNumber: null })).toBe(false);
    expect(showFssaiWarning({ kind: "goods", publishStorefront: true, fssaiNumber: null })).toBe(false);
  });
});
