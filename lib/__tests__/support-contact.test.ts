import { describe, expect, it } from "vitest";

import { SUPPORT_EMAIL } from "@/lib/business-contact";
import { sellerSupportWhatsappUrl, supportContacts } from "@/lib/support-contact";
import { signUpSchema } from "@/lib/zod-auth";

describe("supportContacts", () => {
  it("has no WhatsApp row unless a usable number is configured", () => {
    expect(supportContacts(undefined).map((c) => c.id)).toEqual(["email", "phone", "form"]);
    expect(supportContacts("12345").map((c) => c.id)).not.toContain("whatsapp");
  });
  it("puts WhatsApp first when configured and always offers email and the form", () => {
    const list = supportContacts("98765 43210");
    expect(list.map((c) => c.id)).toEqual(["whatsapp", "email", "phone", "form"]);
    expect(list[0]?.href).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(list.find((c) => c.id === "email")?.href).toBe(`mailto:${SUPPORT_EMAIL}`);
    expect(list.find((c) => c.id === "form")?.href).toBe("/contact");
  });
  it("rejects a non-mobile number", () => {
    expect(sellerSupportWhatsappUrl("0402345678")).toBeNull();
  });
});

describe("signUpSchema.acceptedTerms", () => {
  const base = { email: "a@b.co", password: "password123", name: "A", stallName: "S", stallType: "STREET_FOOD" };
  it("requires the box to be ticked", () => {
    expect(signUpSchema.safeParse(base).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, acceptedTerms: false }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, acceptedTerms: true }).success).toBe(true);
  });
});
