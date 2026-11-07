import { describe, expect, it } from "vitest";

import { supportWhatsappUrl } from "@/lib/support-whatsapp";

describe("supportWhatsappUrl", () => {
  it("links an Indian mobile with a prefilled message", () => {
    const url = supportWhatsappUrl("98765 43210");
    expect(url).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(supportWhatsappUrl("+91 98765-43210")).toBe(url);
  });

  it("is null when unset or not a mobile, so no button shows", () => {
    expect(supportWhatsappUrl("")).toBeNull();
    expect(supportWhatsappUrl(undefined)).toBeNull();
    expect(supportWhatsappUrl("040 2345 6789")).toBeNull();
    expect(supportWhatsappUrl("12345")).toBeNull();
  });
});
