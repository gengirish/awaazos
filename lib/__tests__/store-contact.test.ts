import { describe, expect, it } from "vitest";

import { feedbackMailtoUrl, feedbackRequestMessage, storeContact } from "@/lib/store-contact";

describe("storeContact", () => {
  it("lists owner emails first, lower-cased, without repeats", () => {
    const c = storeContact({
      phone: null,
      email: "Sam@Example.com",
      whatsappNumber: null,
      owners: [
        { name: "Sam Rao", email: "sam@example.com" },
        { name: null, email: "partner@example.com" },
      ],
    });
    expect(c.emails).toEqual(["sam@example.com", "partner@example.com"]);
    expect(c.ownerName).toBe("Sam Rao");
  });

  it("puts WhatsApp first and drops the sign-up phone when it is the same number", () => {
    expect(
      storeContact({ phone: "+919876543210", email: null, whatsappNumber: "98765 43210", owners: [] }).phones,
    ).toEqual([{ number: "98765 43210", label: "WhatsApp" }]);
    expect(
      storeContact({ phone: "+919876543210", email: null, whatsappNumber: "+919123456780", owners: [] }).phones,
    ).toEqual([
      { number: "+919123456780", label: "WhatsApp" },
      { number: "+919876543210", label: "Sign-up phone" },
    ]);
  });

  it("is empty when nothing is saved", () => {
    expect(storeContact({ phone: " ", email: "", whatsappNumber: null, owners: [] })).toEqual({
      ownerName: null,
      emails: [],
      phones: [],
    });
  });
});

describe("feedbackRequestMessage", () => {
  it("greets the owner, names the store and asks before quoting", () => {
    const text = feedbackRequestMessage({ ownerName: "Sam Rao", storeName: "Sam Store", senderName: "Girish H" });
    expect(text.startsWith("Hi Sam,")).toBe(true);
    expect(text).toContain("I'm Girish from AwaazOS");
    expect(text).toContain("Sam Store");
    expect(text).toContain("only use it after you say yes in writing");
  });

  it("falls back when names are missing", () => {
    const text = feedbackRequestMessage({ ownerName: null, storeName: "Sam Store", senderName: null });
    expect(text.startsWith("Hi,")).toBe(true);
    expect(text).toContain("I'm writing from AwaazOS");
    expect(text.endsWith("AwaazOS")).toBe(true);
  });
});

describe("feedbackMailtoUrl", () => {
  it("addresses every email and encodes subject and body", () => {
    const url = feedbackMailtoUrl(["a@x.com", "b@x.com"], "Hi & thanks\nok");
    expect(url).toBe(
      "mailto:a@x.com,b@x.com?subject=How%20is%20AwaazOS%20working%20for%20you%3F&body=Hi%20%26%20thanks%0Aok",
    );
  });

  it("is null with no email", () => {
    expect(feedbackMailtoUrl([], "x")).toBeNull();
  });
});
