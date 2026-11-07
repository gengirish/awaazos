import { describe, expect, it } from "vitest";

import {
  CONNECT_OUTCOME_RE,
  connectOutcomeMessage,
  connectReturnPath,
  parseConnectReturn,
  razorpayConnectHref,
} from "@/lib/razorpay-connect";

describe("Connect Razorpay return", () => {
  it("knows setup and nothing else", () => {
    expect(parseConnectReturn("onboarding")).toBe("onboarding");
    for (const raw of [null, undefined, "", "Onboarding", "/onboarding", "https://evil.example", "toString", "__proto__"]) {
      expect(parseConnectReturn(raw)).toBeNull();
    }
  });

  it("comes back to setup or to Settings → Payments, never a URL it was given", () => {
    expect(connectReturnPath("onboarding")).toBe("/onboarding");
    expect(connectReturnPath(null)).toBe("/settings/payments");
    expect(connectReturnPath(parseConnectReturn("//evil.example"))).toBe("/settings/payments");
  });

  it("builds the start link for each page", () => {
    expect(razorpayConnectHref()).toBe("/api/vendor/payments/razorpay/connect");
    expect(razorpayConnectHref("onboarding")).toBe("/api/vendor/payments/razorpay/connect?return=onboarding");
  });
});

describe("Connect Razorpay outcome", () => {
  it("reads a known code and treats anything else as a failed connect", () => {
    expect(connectOutcomeMessage("connected")).toEqual({ text: expect.stringContaining("connected"), ok: true });
    expect(connectOutcomeMessage("denied").ok).toBe(false);
    expect(connectOutcomeMessage("constructor")).toEqual(connectOutcomeMessage("error"));
    expect(connectOutcomeMessage("whatever")).toEqual(connectOutcomeMessage("error"));
  });

  it("only lets short lowercase codes through", () => {
    expect(CONNECT_OUTCOME_RE.test("owner_only")).toBe(true);
    expect(CONNECT_OUTCOME_RE.test("<script>")).toBe(false);
    expect(CONNECT_OUTCOME_RE.test("a".repeat(25))).toBe(false);
  });
});
