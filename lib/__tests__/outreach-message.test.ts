import { describe, expect, it } from "vitest";

import { TRIAL_DAYS } from "@/lib/constants";
import { firstName, outreachClaimMessage, outreachIntroMessage, outreachWhatsappUrl } from "@/lib/outreach-message";

const STORE_URL = "https://awaazos.intelliforge.tech/s/tasty-treats-by-lah-x5yj";

describe("outreachIntroMessage", () => {
  it("names the owner, the sender, the store and its link", () => {
    const text = outreachIntroMessage({
      ownerName: "Lahari Pruthvi",
      senderName: "Girish Hiremath",
      storeName: "Tasty Treats by Lah",
      storeUrl: STORE_URL,
    });
    expect(text.startsWith("Hi Lahari, I'm Girish, founder of IntelliForge.")).toBe(true);
    expect(text).toContain("Instagram and WhatsApp");
    expect(text).toContain(`demo store for Tasty Treats by Lah with your menu on it: ${STORE_URL}`);
    expect(text).toContain("advance and balance due on one board");
    expect(text).toContain("Nothing is live and nothing is charged");
    expect(text).toContain(`yours free for ${TRIAL_DAYS} days`);
    expect(text).toContain("15 minutes this week");
  });

  it("reads naturally with no owner or sender name", () => {
    const text = outreachIntroMessage({ storeName: "Frosted", storeUrl: STORE_URL });
    expect(text.startsWith("Hi, I'm writing from IntelliForge. We build AwaazOS")).toBe(true);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });
});

describe("outreachClaimMessage", () => {
  it("carries the claim link, the trial length and the expiry", () => {
    const text = outreachClaimMessage({
      ownerName: "Ayesha",
      storeName: "Frosted",
      claimUrl: "https://awaazos.intelliforge.tech/claim/abc",
      expiresOn: "21/10/2026",
    });
    expect(text.startsWith("Hi Ayesha, here is your link to make Frosted yours: https://awaazos.intelliforge.tech/claim/abc")).toBe(true);
    expect(text).toContain(`${TRIAL_DAYS}-day free trial`);
    expect(text).toContain("works once, until 21/10/2026.");
  });

  it("falls back to the link lifetime when no date is given", () => {
    expect(outreachClaimMessage({ storeName: "Frosted", claimUrl: "u" })).toContain("works once for 7 days.");
  });
});

describe("outreachWhatsappUrl", () => {
  it("opens a chat with the seller's number and the encoded text", () => {
    expect(outreachWhatsappUrl("Hi & bye", "+919845431188")).toBe("https://wa.me/919845431188?text=Hi%20%26%20bye");
    expect(outreachWhatsappUrl("Hi", "98454 31188")).toBe("https://wa.me/919845431188?text=Hi");
  });
  it("lets WhatsApp pick the chat when there is no number, and refuses a broken one", () => {
    expect(outreachWhatsappUrl("Hi", null)).toBe("https://wa.me/?text=Hi");
    expect(outreachWhatsappUrl("Hi", "12345")).toBeNull();
  });
});

describe("firstName", () => {
  it("takes the first word", () => {
    expect(firstName("  Lahari  Pruthvi ")).toBe("Lahari");
    expect(firstName(null)).toBe("");
  });
});
