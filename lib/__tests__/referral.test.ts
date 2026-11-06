import { describe, expect, it } from "vitest";

import type { BillingAccess } from "@/lib/plan";
import {
  canPromoteReferrals,
  extendTrialEndsAt,
  isSelfReferral,
  monthsUnderCap,
  parseReferralCode,
  redemptionFor,
  referralPitch,
  REFERRAL_MONTH_DAYS,
  REFERRAL_REWARD_CAP_PER_YEAR,
  REFERRED_TRIAL_DAYS,
  referralSignUpPath,
  referralSignUpUrl,
  rewardMonthsFor,
  signUpTrialEndsAt,
} from "@/lib/referral";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-11-01T06:30:00.000Z");

describe("parseReferralCode", () => {
  it("normalises case and whitespace", () => {
    expect(parseReferralCode("  Sam-Store ")).toBe("sam-store");
    expect(parseReferralCode("abc")).toBe("abc");
  });

  it("rejects non-strings, too short, too long and bad characters", () => {
    expect(parseReferralCode(null)).toBeNull();
    expect(parseReferralCode(undefined)).toBeNull();
    expect(parseReferralCode("")).toBeNull();
    expect(parseReferralCode("ab")).toBeNull();
    expect(parseReferralCode("a".repeat(60))).toBe("a".repeat(60));
    expect(parseReferralCode("a".repeat(61))).toBeNull();
    expect(parseReferralCode("sam_store")).toBeNull();
    expect(parseReferralCode("sam store")).toBeNull();
    expect(parseReferralCode("sam/../store")).toBeNull();
    expect(parseReferralCode("<script>")).toBeNull();
  });
});

describe("referralSignUpPath / referralSignUpUrl", () => {
  it("builds the sign-up path with the ref param", () => {
    expect(referralSignUpPath("sam-store")).toBe("/sign-up?ref=sam-store");
  });

  it("joins origin without doubling slashes", () => {
    expect(referralSignUpUrl("https://awaazos.intelliforge.tech", "sam-store")).toBe(
      "https://awaazos.intelliforge.tech/sign-up?ref=sam-store",
    );
    expect(referralSignUpUrl("https://awaazos.intelliforge.tech//", "sam-store")).toBe(
      "https://awaazos.intelliforge.tech/sign-up?ref=sam-store",
    );
  });

  it("encodes the slug", () => {
    expect(referralSignUpUrl("https://x.test", "a b&c")).toBe("https://x.test/sign-up?ref=a%20b%26c");
  });
});

describe("rewardMonthsFor", () => {
  it("is 1 for monthly and 2 for yearly", () => {
    expect(rewardMonthsFor("monthly")).toBe(1);
    expect(rewardMonthsFor("yearly")).toBe(2);
  });
});

describe("monthsUnderCap", () => {
  it("grants the full amount with room left", () => {
    expect(monthsUnderCap(0, 1)).toBe(1);
    expect(monthsUnderCap(0, 2)).toBe(2);
    expect(monthsUnderCap(REFERRAL_REWARD_CAP_PER_YEAR - 2, 2)).toBe(2);
  });

  it("grants only what fits under the cap", () => {
    expect(monthsUnderCap(REFERRAL_REWARD_CAP_PER_YEAR - 1, 2)).toBe(1);
  });

  it("grants nothing at or past the cap", () => {
    expect(monthsUnderCap(REFERRAL_REWARD_CAP_PER_YEAR, 1)).toBe(0);
    expect(monthsUnderCap(REFERRAL_REWARD_CAP_PER_YEAR + 5, 2)).toBe(0);
  });
});

describe("redemptionFor", () => {
  const states: Record<string, BillingAccess> = {
    paid: { kind: "paid", plan: "STARTER" },
    trial: { kind: "trial", endsAt: new Date(NOW.getTime() + 10 * DAY_MS) },
    locked: { kind: "locked", since: new Date(NOW.getTime() - DAY_MS) },
    free: { kind: "free" },
  };

  it("banks for every state when a live subscription exists", () => {
    for (const access of Object.values(states)) {
      expect(redemptionFor(access, true)).toEqual({ kind: "bank", reason: "live_subscription" });
    }
  });

  it("banks for a paid store even without a live subscription", () => {
    expect(redemptionFor(states.paid, false)).toEqual({ kind: "bank", reason: "live_subscription" });
  });

  it("banks for a grandfathered free store", () => {
    expect(redemptionFor(states.free, false)).toEqual({ kind: "bank", reason: "free_store" });
  });

  it("extends the trial for a trial or locked store with no live subscription", () => {
    expect(redemptionFor(states.trial, false)).toEqual({ kind: "extend_trial" });
    expect(redemptionFor(states.locked, false)).toEqual({ kind: "extend_trial" });
  });
});

describe("extendTrialEndsAt", () => {
  const monthMs = REFERRAL_MONTH_DAYS * DAY_MS;

  it("counts from now when the trial already ended", () => {
    const past = new Date(NOW.getTime() - 5 * DAY_MS);
    expect(extendTrialEndsAt(past, 1, NOW).getTime()).toBe(NOW.getTime() + monthMs);
  });

  it("counts from now when there is no trial end", () => {
    expect(extendTrialEndsAt(null, 2, NOW).getTime()).toBe(NOW.getTime() + 2 * monthMs);
  });

  it("keeps the days left when the trial is still running", () => {
    const future = new Date(NOW.getTime() + 7 * DAY_MS);
    expect(extendTrialEndsAt(future, 2, NOW).getTime()).toBe(future.getTime() + 2 * monthMs);
  });

  it("counts from now when the trial ends exactly now", () => {
    expect(extendTrialEndsAt(new Date(NOW), 1, NOW).getTime()).toBe(NOW.getTime() + monthMs);
  });
});

describe("signUpTrialEndsAt", () => {
  it("uses the normal trial when not referred", () => {
    expect(signUpTrialEndsAt(false, 30, NOW).getTime()).toBe(NOW.getTime() + 30 * DAY_MS);
  });

  it("uses the referred trial when referred", () => {
    expect(signUpTrialEndsAt(true, 30, NOW).getTime()).toBe(
      NOW.getTime() + REFERRED_TRIAL_DAYS * DAY_MS,
    );
  });
});

describe("isSelfReferral", () => {
  it("matches email case-insensitively and trimmed", () => {
    expect(
      isSelfReferral({ email: " Cook@Example.com", phone: null }, { email: "cook@example.com ", phone: null }),
    ).toBe(true);
  });

  it("matches the same E.164 phone", () => {
    expect(
      isSelfReferral(
        { email: "a@example.com", phone: "+919876543210" },
        { email: "b@example.com", phone: "+919876543210" },
      ),
    ).toBe(true);
  });

  it("is false for different people", () => {
    expect(
      isSelfReferral(
        { email: "a@example.com", phone: "+919876543210" },
        { email: "b@example.com", phone: "+919876543211" },
      ),
    ).toBe(false);
  });

  it("does not match on missing values", () => {
    expect(isSelfReferral({ email: null, phone: null }, { email: "b@example.com", phone: null })).toBe(false);
    expect(
      isSelfReferral({ email: null, phone: "+919876543210" }, { email: "b@example.com", phone: undefined }),
    ).toBe(false);
  });
});

describe("canPromoteReferrals", () => {
  const trial: BillingAccess = { kind: "trial", endsAt: new Date("2030-01-01T00:00:00.000Z") };
  const base = { role: "OWNER", isDemo: false, access: trial, hasLiveSubscription: false };

  it("advertises to an owner whose reward would apply at once", () => {
    expect(canPromoteReferrals(base)).toBe(true);
    expect(canPromoteReferrals({ ...base, access: { kind: "locked", since: NOW } })).toBe(true);
  });

  it("does not advertise months a store could only bank", () => {
    expect(canPromoteReferrals({ ...base, hasLiveSubscription: true })).toBe(false);
    expect(canPromoteReferrals({ ...base, access: { kind: "paid", plan: "STARTER" } })).toBe(false);
    expect(canPromoteReferrals({ ...base, access: { kind: "free" } })).toBe(false);
  });

  it("skips staff and demo stores", () => {
    expect(canPromoteReferrals({ ...base, role: "MANAGER" })).toBe(false);
    expect(canPromoteReferrals({ ...base, isDemo: true })).toBe(false);
  });
});

describe("referralPitch", () => {
  it("states the trial and the reward from the constants", () => {
    expect(referralPitch()).toContain(`${REFERRED_TRIAL_DAYS} days free`);
    expect(referralPitch()).toContain(`${rewardMonthsFor("monthly")} free month`);
  });
});
