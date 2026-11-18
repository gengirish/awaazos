import { describe, expect, it } from "vitest";

import { generateHandoverPassword, handoverLoginText } from "@/lib/handover-password";
import { checkPasswordPolicy } from "@/lib/password-strength";

describe("generateHandoverPassword", () => {
  it("is three readable groups that pass the password policy", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateHandoverPassword();
      expect(pw).toMatch(/^[a-hjkmnp-z]{4}-[2-9]{4}-[a-hjkmnp-z]{4}$/);
      expect(checkPasswordPolicy(pw)).toEqual({ ok: true });
    }
  });

  it("uses the random source it is given", () => {
    expect(generateHandoverPassword((n) => Array.from({ length: n }, () => 0))).toBe("aaaa-2222-aaaa");
  });
});

describe("handoverLoginText", () => {
  it("carries the link, email and password", () => {
    const pw = generateHandoverPassword();
    const text = handoverLoginText({ storeName: "Moti Lane", email: "a@b.in", password: pw, signInUrl: "https://x/sign-in" });
    expect(text).toContain("https://x/sign-in");
    expect(text).toContain("Email: a@b.in");
    expect(text).toContain(`Password: ${pw}`);
  });
});
