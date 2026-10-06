import { describe, expect, it } from "vitest";

import { buildQrUrl, buildUpiCollectLink, buildUpiDeepLink, isValidUpiId, normalizeUpiId, UPI_ID_PATTERN } from "./upi";

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

describe("buildUpiCollectLink", () => {
  function paramsOf(link: string): URLSearchParams {
    return new URLSearchParams(link.slice("upi://pay?".length));
  }

  it("omits the amount so the customer enters it in their UPI app", () => {
    const params = paramsOf(buildUpiCollectLink({ upiId: "ravi@okaxis", name: "Ravi Bhel" }));
    expect(params.get("am")).toBeNull();
    expect(params.get("tn")).toBeNull();
  });

  it("carries payee address, payee name and INR", () => {
    const params = paramsOf(buildUpiCollectLink({ upiId: "ravi@okaxis", name: "Ravi Bhel" }));
    expect(params.get("pa")).toBe("ravi@okaxis");
    expect(params.get("pn")).toBe("Ravi Bhel");
    expect(params.get("cu")).toBe("INR");
  });

  it("percent-encodes names that would otherwise break the query string", () => {
    const link = buildUpiCollectLink({ upiId: "a@b", name: "Chai & Co #1" });
    expect(link).not.toContain("&Co");
    expect(paramsOf(link).get("pn")).toBe("Chai & Co #1");
  });

  it("survives the QR wrapper intact", () => {
    const link = buildUpiCollectLink({ upiId: "ravi@okaxis", name: "Ravi Bhel" });
    const qr = buildQrUrl(link, 220);
    expect(qr).toContain("size=220x220");
    expect(decodeURIComponent(qr.split("&data=")[1])).toBe(link);
  });
});

describe("UPI ID validation", () => {
  it("accepts common VPAs and trims whitespace", () => {
    for (const id of ["shop@okaxis", "ravi.kumar-1@ybl", "9876543210@paytm", "  a_b@oksbi  ", "Shop@OkHdfcBank"]) {
      expect(isValidUpiId(id), id).toBe(true);
    }
    expect(normalizeUpiId("  shop@okaxis ")).toBe("shop@okaxis");
  });

  it("keeps the case as typed", () => {
    expect(normalizeUpiId("Shop@OkAxis")).toBe("Shop@OkAxis");
  });

  it("rejects things that are not a VPA", () => {
    for (const id of ["", "shop", "@okaxis", "a@okaxis", "shop@", "shop@1bank", "shop@o", "sh op@okaxis", "shop@@okaxis", "shop@ok axis"]) {
      expect(isValidUpiId(id), id).toBe(false);
    }
    expect(UPI_ID_PATTERN.test("shop@okaxis")).toBe(true);
  });
});
