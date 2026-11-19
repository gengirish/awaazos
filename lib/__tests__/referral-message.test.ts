import { describe, expect, it } from "vitest";

import { TRIAL_DAYS } from "@/lib/constants";
import { REFERRED_TRIAL_DAYS, referralSignUpUrl } from "@/lib/referral";
import { referralLinkLabel, referralWhatsappMessage, referralWhatsappUrl } from "@/lib/referral-message";
import { BRAND_NAME } from "@/lib/brand";

const link = referralSignUpUrl("https://awaazos.example", "sam-store");

describe("referralWhatsappMessage", () => {
  it("names the store, the longer trial and the link", () => {
    const text = referralWhatsappMessage({ storeName: "Sam Store", link });
    expect(text).toContain(`I run Sam Store on ${BRAND_NAME}.`);
    expect(text).toContain(`${REFERRED_TRIAL_DAYS} days free instead of ${TRIAL_DAYS}`);
    expect(text.trim().endsWith(link)).toBe(true);
  });

  it("reads naturally without a store name", () => {
    const text = referralWhatsappMessage({ storeName: "  ", link });
    expect(text).toContain(`I run my store on ${BRAND_NAME}.`);
    expect(text).not.toContain("I run  on");
  });

  it("stays short and plain: no catalogue words, no emoji, no reward talk", () => {
    const text = referralWhatsappMessage({ storeName: "Sam Store", link });
    expect(text.length).toBeLessThan(400);
    expect(text).not.toMatch(/\bmenu\b|\bdish(es)?\b|\bproducts?\b/i);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/free month|reward|cash/i);
  });
});

describe("referralWhatsappUrl", () => {
  it("opens WhatsApp with no number and the text encoded", () => {
    const text = referralWhatsappMessage({ storeName: "Sam & Co", link });
    const url = referralWhatsappUrl(text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe(text);
  });
});

describe("referralLinkLabel", () => {
  it("drops the scheme for print", () => {
    expect(referralLinkLabel(link)).toBe("awaazos.example/sign-up?ref=sam-store");
    expect(referralLinkLabel("http://localhost:3000/")).toBe("localhost:3000");
  });
});
