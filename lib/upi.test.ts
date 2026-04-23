import { describe, expect, it } from "vitest";

import { buildQrUrl, buildUpiDeepLink } from "./upi";

describe("upi", () => {
  it("buildUpiDeepLink encodes UPI params", () => {
    const link = buildUpiDeepLink({
      upiId: "shop@okaxis",
      name: "Test Stall",
      amountRupees: 20,
      billRef: "AWZ-20260101-0001",
    });
    expect(link.startsWith("upi://pay?")).toBe(true);
    expect(link).toContain("pa=shop%40okaxis");
    expect(link).toContain("am=20.00");
    expect(link).toContain("cu=INR");
  });

  it("buildQrUrl wraps encoded link", () => {
    const url = buildQrUrl("upi://pay?pa=x&pn=y&am=1.00&cu=INR&tn=z", 256);
    expect(url).toContain("size=256x256");
    expect(url).toContain(encodeURIComponent("upi://pay?pa=x&pn=y&am=1.00&cu=INR&tn=z"));
  });
});
