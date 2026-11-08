import { StallType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  normaliseStoreHandle,
  RESERVED_STORE_HANDLES,
  STORE_HANDLE_FORMAT_MESSAGE,
  STORE_HANDLE_LENGTH_MESSAGE,
  STORE_HANDLE_MAX,
  STORE_HANDLE_REQUIRED_MESSAGE,
  STORE_HANDLE_RESERVED_MESSAGE,
  storeHandleProblem,
  storeHandleSchema,
  storeHandleWhileTyping,
  storeLinkPrefix,
} from "@/lib/store-handle";
import { newVendorSlug, slugBase } from "@/lib/store-slug";
import { signUpSchema } from "@/lib/zod-auth";

describe("normaliseStoreHandle", () => {
  it("turns a store name into a link handle", () => {
    expect(normaliseStoreHandle("The Ember Room")).toBe("the-ember-room");
    expect(normaliseStoreHandle("Prankie's Bakery")).toBe("prankie-s-bakery");
    expect(normaliseStoreHandle("  Ravi's   Bhel!! ")).toBe("ravi-s-bhel");
  });

  it("strips accents and keeps digits", () => {
    expect(normaliseStoreHandle("Café 24x7")).toBe("cafe-24x7");
  });

  it("is empty for a name with nothing url-safe in it, so the owner must type one", () => {
    expect(normaliseStoreHandle("शर्मा चाट")).toBe("");
    expect(normaliseStoreHandle("---")).toBe("");
  });

  it("cuts at the limit without leaving a trailing hyphen", () => {
    const long = "a".repeat(STORE_HANDLE_MAX - 1) + " bakery";
    const out = normaliseStoreHandle(long);
    expect(out.length).toBeLessThanOrEqual(STORE_HANDLE_MAX);
    expect(out.endsWith("-")).toBe(false);
    expect(storeHandleProblem(out)).toBeNull();
  });
});

describe("storeHandleWhileTyping", () => {
  it("keeps a trailing hyphen so a hyphenated handle can be typed", () => {
    expect(storeHandleWhileTyping("ember-")).toBe("ember-");
    expect(storeHandleWhileTyping("Ember Room")).toBe("ember-room");
    expect(storeHandleWhileTyping("--ember--room--")).toBe("ember-room-");
  });

  it("settles to the normalised handle on blur", () => {
    expect(normaliseStoreHandle(storeHandleWhileTyping("ember-"))).toBe("ember");
  });
});

describe("storeHandleProblem", () => {
  it("accepts a plain handle, with digits and single hyphens", () => {
    expect(storeHandleProblem("ravis-bhel")).toBeNull();
    expect(storeHandleProblem("cafe24")).toBeNull();
    expect(storeHandleProblem("abc")).toBeNull();
    expect(storeHandleProblem("a".repeat(STORE_HANDLE_MAX))).toBeNull();
  });

  it("names the rule that is broken", () => {
    expect(storeHandleProblem("")).toBe(STORE_HANDLE_REQUIRED_MESSAGE);
    expect(storeHandleProblem("ab")).toBe(STORE_HANDLE_LENGTH_MESSAGE);
    expect(storeHandleProblem("a".repeat(STORE_HANDLE_MAX + 1))).toBe(STORE_HANDLE_LENGTH_MESSAGE);
    expect(storeHandleProblem("Ravis")).toBe(STORE_HANDLE_FORMAT_MESSAGE);
    expect(storeHandleProblem("ravi s")).toBe(STORE_HANDLE_FORMAT_MESSAGE);
    expect(storeHandleProblem("-ravi")).toBe(STORE_HANDLE_FORMAT_MESSAGE);
    expect(storeHandleProblem("ravi-")).toBe(STORE_HANDLE_FORMAT_MESSAGE);
    expect(storeHandleProblem("ravi--s")).toBe(STORE_HANDLE_FORMAT_MESSAGE);
    expect(storeHandleProblem("ravi_s")).toBe(STORE_HANDLE_FORMAT_MESSAGE);
  });

  it("refuses the reserved words, each of which passes the format rules", () => {
    for (const word of RESERVED_STORE_HANDLES) {
      expect(storeHandleProblem(word), word).toBe(STORE_HANDLE_RESERVED_MESSAGE);
    }
    expect(RESERVED_STORE_HANDLES.has("awaazos")).toBe(true);
    expect(RESERVED_STORE_HANDLES.has("admin")).toBe(true);
  });
});

describe("storeHandleSchema", () => {
  it("lowercases and trims what was typed", () => {
    expect(storeHandleSchema.parse("  Ravis-Bhel ")).toBe("ravis-bhel");
  });

  it("carries the rule message on failure", () => {
    const r = storeHandleSchema.safeParse("ab");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(STORE_HANDLE_LENGTH_MESSAGE);
    expect(storeHandleSchema.safeParse("demo").success).toBe(false);
  });
});

describe("signUpSchema.storeHandle", () => {
  const base = {
    email: "owner@example.com",
    password: "password123",
    name: "Owner",
    stallName: "Ravi's Bhel",
    stallType: StallType.STREET_FOOD,
  };

  it("is optional, so older clients and the e2e helper still register", () => {
    expect(signUpSchema.safeParse(base).success).toBe(true);
  });

  it("validates a chosen handle with the shared rules", () => {
    const ok = signUpSchema.safeParse({ ...base, storeHandle: "Ravis-Bhel" });
    expect(ok.success).toBe(true);
    expect(ok.data?.storeHandle).toBe("ravis-bhel");
    expect(signUpSchema.safeParse({ ...base, storeHandle: "ra" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, storeHandle: "awaazos" }).success).toBe(false);
  });
});

describe("store-slug fallback", () => {
  it("builds on the same normalisation and adds a 4-character suffix", () => {
    expect(slugBase("Prankie's Bakery")).toBe("prankie-s-bakery");
    expect(slugBase("शर्मा चाट")).toBe("stall");
    expect(newVendorSlug("Ravi's Bhel")).toMatch(/^ravi-s-bhel-[a-z0-9]{4}$/);
  });

  it("always produces something the handle rules accept", () => {
    for (const name of ["Ravi's Bhel", "A", "x".repeat(200), "शर्मा चाट", "--", "Café 24x7"]) {
      expect(storeHandleProblem(newVendorSlug(name)), name).toBeNull();
    }
  });
});

describe("storeLinkPrefix", () => {
  it("shows the host and the /s/ path", () => {
    expect(storeLinkPrefix("awaazos.in")).toBe("awaazos.in/s/");
  });
});
