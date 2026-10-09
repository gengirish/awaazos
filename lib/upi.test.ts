import { describe, expect, it } from "vitest";

import {
  buildUpiCollectLink,
  buildUpiDeepLink,
  isAppleMobile,
  isValidUpiId,
  normalizeUpiId,
  UPI_APPS,
  UPI_ID_PATTERN,
  upiAmountText,
  upiAppLink,
  upiAppLinks,
} from "./upi";

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

describe("app-specific UPI links (iOS)", () => {
  const generic = buildUpiDeepLink({
    upiId: "shop@okaxis",
    name: "Chai & Co",
    amountRupees: 120.5,
    billRef: "AWZ-20260101-0001",
  });
  const query = generic.slice("upi://pay?".length);

  it("uses the documented scheme per app", () => {
    expect(upiAppLink("gpay", generic)).toBe(`tez://upi/pay?${query}`);
    expect(upiAppLink("phonepe", generic)).toBe(`phonepe://pay?${query}`);
    expect(upiAppLink("paytm", generic)).toBe(`paytmmp://upi/pay?${query}`);
  });

  it("keeps every NPCI param, including the amount in rupees, untouched", () => {
    for (const { href } of upiAppLinks(generic)) {
      const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
      expect(params.get("pa")).toBe("shop@okaxis");
      expect(params.get("pn")).toBe("Chai & Co");
      expect(params.get("am")).toBe("120.50");
      expect(params.get("cu")).toBe("INR");
      expect(params.get("tn")).toBe("AWZ-20260101-0001");
    }
  });

  it("works for the amount-less storefront collect link", () => {
    const collect = buildUpiCollectLink({ upiId: "ravi@okaxis", name: "Ravi Bhel" });
    const phonepe = upiAppLink("phonepe", collect);
    expect(phonepe?.startsWith("phonepe://pay?")).toBe(true);
    expect(new URLSearchParams(phonepe!.slice("phonepe://pay?".length)).get("am")).toBeNull();
  });

  it("returns one link per app, in UPI_APPS order", () => {
    expect(upiAppLinks(generic).map((l) => l.id)).toEqual(UPI_APPS.map((a) => a.id));
    expect(upiAppLinks(generic).map((l) => l.label)).toEqual(["Google Pay", "PhonePe", "Paytm"]);
  });

  it("refuses anything that is not a upi://pay link", () => {
    expect(upiAppLink("gpay", "https://evil.example/?pa=x@y")).toBeNull();
    expect(upiAppLink("gpay", "")).toBeNull();
    expect(upiAppLinks("javascript:alert(1)")).toEqual([]);
  });
});

describe("isAppleMobile", () => {
  it("detects iPhone and iPod", () => {
    expect(
      isAppleMobile(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        "iPhone",
        5,
      ),
    ).toBe(true);
    expect(isAppleMobile("Mozilla/5.0 (iPod touch; CPU iPhone OS 12_0 like Mac OS X)")).toBe(true);
  });

  it("detects iPadOS that masquerades as a Mac", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    expect(isAppleMobile(ua, "MacIntel", 5)).toBe(true);
    expect(isAppleMobile(ua, "MacIntel", 0)).toBe(false);
  });

  it("is false on Android and desktop", () => {
    expect(
      isAppleMobile("Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36", "Linux armv8l", 5),
    ).toBe(false);
    expect(isAppleMobile("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 0)).toBe(false);
    expect(isAppleMobile("")).toBe(false);
  });
});

describe("upiAmountText", () => {
  it("formats paise as plain rupees for pasting", () => {
    expect(upiAmountText(12000)).toBe("120");
    expect(upiAmountText(12050)).toBe("120.50");
    expect(upiAmountText(12005)).toBe("120.05");
    expect(upiAmountText(5)).toBe("0.05");
    expect(upiAmountText(12345600)).toBe("123456");
  });

  it("rejects non-integer or negative paise", () => {
    expect(() => upiAmountText(10.5)).toThrow(RangeError);
    expect(() => upiAmountText(-1)).toThrow(RangeError);
  });
});
