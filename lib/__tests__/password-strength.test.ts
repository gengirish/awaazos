import { describe, expect, it } from "vitest";

import {
  checkPasswordPolicy,
  isCommonPassword,
  passwordStrength,
} from "@/lib/password-strength";

describe("password-strength", () => {
  describe("isCommonPassword", () => {
    it("flags top global breached passwords case-insensitively", () => {
      expect(isCommonPassword("password")).toBe(true);
      expect(isCommonPassword("Password")).toBe(true);
      expect(isCommonPassword("PASSWORD")).toBe(true);
      expect(isCommonPassword("qwerty123")).toBe(true);
    });
    it("flags India-specific common patterns", () => {
      expect(isCommonPassword("india1947")).toBe(true);
      expect(isCommonPassword("mumbai12")).toBe(true);
      expect(isCommonPassword("cricket1")).toBe(true);
    });
    it("flags app-specific predictable variants", () => {
      expect(isCommonPassword("awaazos1")).toBe(true);
      expect(isCommonPassword("awaaz123")).toBe(true);
    });
    it("does not flag genuinely strong passwords", () => {
      expect(isCommonPassword("p9.kJ#7!mw2")).toBe(false);
      expect(isCommonPassword("Hyderabad-Chai-2026!")).toBe(false);
    });
  });

  describe("passwordStrength", () => {
    it("scores empty as weak/0", () => {
      expect(passwordStrength("")).toEqual({ strength: "weak", score: 0 });
    });
    it("scores short single-class as weak", () => {
      expect(passwordStrength("aaaaaaaa").strength).toBe("weak");
    });
    it("caps blocklisted passwords at score 1 (weak) regardless of length/classes", () => {
      const r = passwordStrength("password123");
      expect(r.strength).toBe("weak");
      expect(r.score).toBeLessThanOrEqual(1);
    });
    it("scores 12+ chars + 3 classes as ok or strong", () => {
      expect(passwordStrength("MyChaiStall23").strength).not.toBe("weak");
    });
    it("scores 16+ chars + all 4 classes as strong", () => {
      const r = passwordStrength("MyChaiStall-23!Hi");
      expect(r.strength).toBe("strong");
      expect(r.score).toBeGreaterThanOrEqual(5);
    });
  });

  describe("checkPasswordPolicy", () => {
    it("rejects too-short", () => {
      const r = checkPasswordPolicy("aB1!a");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/at least 8/i);
    });
    it("rejects too-long (DoS protection)", () => {
      const r = checkPasswordPolicy("a".repeat(129) + "B1!");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/at most 128/i);
    });
    it("rejects common passwords", () => {
      const r = checkPasswordPolicy("password");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/too common/i);
    });
    it("rejects single character class even if 8+", () => {
      const r = checkPasswordPolicy("aaaaaaaa");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/two of/i);
    });
    it("accepts 8 chars + 2 classes that aren't blocklisted", () => {
      const r = checkPasswordPolicy("ChaiHot1");
      expect(r.ok).toBe(true);
    });
    it("accepts strong India-flavoured passphrase", () => {
      const r = checkPasswordPolicy("Hyderabad-Chai-2026!");
      expect(r.ok).toBe(true);
    });
    it("rejects non-string defensively", () => {
      const r = checkPasswordPolicy(undefined as unknown as string);
      expect(r.ok).toBe(false);
    });
  });
});
