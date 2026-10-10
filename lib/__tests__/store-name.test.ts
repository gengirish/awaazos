import { StallType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  STORE_NAME_MAX,
  STORE_NAME_REQUIRED_MESSAGE,
  STORE_NAME_TOO_LONG_MESSAGE,
  storeNameSchema,
} from "@/lib/store-name";
import { signUpSchema } from "@/lib/zod-auth";

describe("storeNameSchema", () => {
  it("trims surrounding whitespace", () => {
    expect(storeNameSchema.parse("  Sharma Chaat Corner  ")).toBe("Sharma Chaat Corner");
  });

  it("rejects an empty or whitespace-only name", () => {
    for (const v of ["", "   "]) {
      const r = storeNameSchema.safeParse(v);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe(STORE_NAME_REQUIRED_MESSAGE);
    }
  });

  it("accepts exactly the max length and rejects one more", () => {
    expect(storeNameSchema.safeParse("a".repeat(STORE_NAME_MAX)).success).toBe(true);
    const r = storeNameSchema.safeParse("a".repeat(STORE_NAME_MAX + 1));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(STORE_NAME_TOO_LONG_MESSAGE);
  });

  it("allows non-Latin names", () => {
    expect(storeNameSchema.parse("शर्मा चाट")).toBe("शर्मा चाट");
  });

  it("matches the sign-up stallName limit, so any registered name can be saved again", () => {
    const base = {
      email: "owner@example.com",
      password: "password123",
      name: "Owner",
      stallType: StallType.STREET_FOOD,
    };
    expect(signUpSchema.safeParse({ ...base, stallName: "a".repeat(STORE_NAME_MAX) }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...base, stallName: "a".repeat(STORE_NAME_MAX + 1) }).success).toBe(false);
  });
});
