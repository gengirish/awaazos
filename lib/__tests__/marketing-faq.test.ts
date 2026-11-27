import { describe, expect, it } from "vitest";

import { PLAN_PRICES_PAISE, PLAN_PRICES_YEARLY_PAISE, TRIAL_DAYS } from "@/lib/constants";
import { formatINRCompact } from "@/lib/currency";
import { MARKETING_FAQ } from "@/lib/marketing-faq";
import { MARKETED_PLANS } from "@/lib/plan-copy";

const answer = (question: RegExp) => MARKETING_FAQ.find((f) => question.test(f.question))?.answer ?? "";

describe("MARKETING_FAQ", () => {
  it("has unique, non-empty questions and answers", () => {
    expect(new Set(MARKETING_FAQ.map((f) => f.question)).size).toBe(MARKETING_FAQ.length);
    for (const f of MARKETING_FAQ) {
      expect(f.question.trim()).not.toBe("");
      expect(f.answer.trim()).not.toBe("");
    }
  });

  it("names Starter as the trial plan and the real trial length", () => {
    expect(answer(/trial on/i)).toContain("Starter");
    expect(answer(/trial on/i)).toContain(`${TRIAL_DAYS} days`);
  });

  it("says nothing is charged at the end, with every plan's real monthly price", () => {
    const end = answer(/trial ends/i);
    expect(end).toMatch(/nothing is charged/i);
    for (const plan of MARKETED_PLANS) expect(end).toContain(formatINRCompact(PLAN_PRICES_PAISE[plan]));
  });

  it("quotes every plan's real yearly price", () => {
    const yearly = answer(/yearly/i);
    for (const plan of MARKETED_PLANS) expect(yearly).toContain(formatINRCompact(PLAN_PRICES_YEARLY_PAISE[plan]!));
  });

  it("never says we hold the seller's money", () => {
    const all = MARKETING_FAQ.map((f) => f.answer).join("\n");
    expect(all).not.toMatch(/we (collect|hold|pay out|transfer)/i);
  });
});
