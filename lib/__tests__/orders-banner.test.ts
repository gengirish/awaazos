import { describe, expect, it } from "vitest";

import {
  BANNER_SNOOZE_DAYS,
  DISMISS_FOR_GOOD,
  isBannerSnoozed,
  looksLikeTestName,
  pickOrdersBanner,
  storePolishNudge,
  SURVEY_SNOOZE_DAYS,
} from "../orders-banner";

const DAY_MS = 24 * 60 * 60 * 1000;
const NONE = { reminder: false, polish: false, install: false, survey: false, refer: false };

describe("pickOrdersBanner", () => {
  it("shows nothing when nothing is eligible", () => {
    expect(pickOrdersBanner(NONE)).toBeNull();
  });

  it("puts the FSSAI reminder above install, and install above the survey", () => {
    expect(pickOrdersBanner({ ...NONE, reminder: true, install: true, survey: true })).toBe("reminder");
    expect(pickOrdersBanner({ ...NONE, install: true, survey: true })).toBe("install");
    expect(pickOrdersBanner({ ...NONE, survey: true, refer: true })).toBe("survey");
  });

  it("shows a lower banner on its own", () => {
    expect(pickOrdersBanner({ ...NONE, survey: true })).toBe("survey");
    expect(pickOrdersBanner({ ...NONE, install: true })).toBe("install");
    expect(pickOrdersBanner({ ...NONE, refer: true })).toBe("refer");
  });
});

describe("isBannerSnoozed", () => {
  const now = 1_800_000_000_000;

  it("is not snoozed when nothing is stored", () => {
    expect(isBannerSnoozed(null, now)).toBe(false);
  });

  it("stays snoozed for the whole window, and lapses at its end", () => {
    expect(BANNER_SNOOZE_DAYS).toBe(7);
    expect(isBannerSnoozed(String(now), now)).toBe(true);
    expect(isBannerSnoozed(String(now - 7 * DAY_MS + 1), now)).toBe(true);
    expect(isBannerSnoozed(String(now - 7 * DAY_MS), now)).toBe(false);
  });

  it("lets the old permanent '1' flag lapse instead of hiding the prompt for good", () => {
    expect(isBannerSnoozed("1", now)).toBe(false);
  });

  it("does not hide a prompt on a bad value or a clock moved back", () => {
    expect(isBannerSnoozed("not-a-time", now)).toBe(false);
    expect(isBannerSnoozed(String(now + DAY_MS), now)).toBe(false);
  });
});

describe("snooze lengths", () => {
  const now = Date.UTC(2026, 10, 7, 6, 0);

  it("the survey's Not now holds for 14 days", () => {
    expect(SURVEY_SNOOZE_DAYS).toBe(14);
    expect(isBannerSnoozed(String(now - 13 * DAY_MS), now, SURVEY_SNOOZE_DAYS)).toBe(true);
    expect(isBannerSnoozed(String(now - 14 * DAY_MS), now, SURVEY_SNOOZE_DAYS)).toBe(false);
  });

  it("a one-time dismissal never lapses", () => {
    expect(isBannerSnoozed(String(now - 400 * DAY_MS), now, DISMISS_FOR_GOOD)).toBe(true);
    expect(isBannerSnoozed(null, now, DISMISS_FOR_GOOD)).toBe(false);
  });
});

describe("storePolishNudge", () => {
  it("spots test items as words, not inside other words", () => {
    expect(looksLikeTestName("Test item")).toBe(true);
    expect(looksLikeTestName("testing 2")).toBe(true);
    expect(looksLikeTestName("TEST1")).toBe(true);
    expect(looksLikeTestName("Protest cake")).toBe(false);
    expect(looksLikeTestName("Tasty testimonial box")).toBe(false);
  });

  it("names test items first, then a missing tagline, else nothing", () => {
    expect(storePolishNudge({ tagline: "Fresh bakes", itemNames: ["Bhel", "Test item"] })).toEqual({
      kind: "test_items",
      names: ["Test item"],
    });
    expect(storePolishNudge({ tagline: "  ", itemNames: ["Bhel"] })).toEqual({ kind: "no_tagline" });
    expect(storePolishNudge({ tagline: "Fresh bakes", itemNames: ["Bhel"] })).toBeNull();
  });

  it("ranks just below the setup reminder", () => {
    expect(pickOrdersBanner({ ...NONE, reminder: true, polish: true })).toBe("reminder");
    expect(pickOrdersBanner({ ...NONE, polish: true, install: true, survey: true })).toBe("polish");
  });
});
