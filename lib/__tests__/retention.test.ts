import { describe, expect, it } from "vitest";

import { RECEIPT_RETENTION_YEARS, VOICE_LOG_RETENTION_DAYS, retentionCutoffs } from "@/lib/retention";

describe("retentionCutoffs", () => {
  it("keeps the numbers the Privacy page promises", () => {
    expect(VOICE_LOG_RETENTION_DAYS).toBe(90);
    expect(RECEIPT_RETENTION_YEARS).toBe(7);
  });

  it("cuts voice logs at exactly 90 days and receipts at 7 calendar years", () => {
    const now = new Date("2026-11-08T03:35:00.000Z");
    const { voiceLogsBefore, receiptsBefore } = retentionCutoffs(now);
    expect(voiceLogsBefore.toISOString()).toBe("2026-08-10T03:35:00.000Z");
    expect(receiptsBefore.toISOString()).toBe("2019-11-08T03:35:00.000Z");
  });

  it("does not mutate the date it is given", () => {
    const now = new Date("2026-11-08T03:35:00.000Z");
    retentionCutoffs(now);
    expect(now.toISOString()).toBe("2026-11-08T03:35:00.000Z");
  });

  it("moves a 29 February start to 1 March seven years earlier", () => {
    const { receiptsBefore } = retentionCutoffs(new Date("2028-02-29T00:00:00.000Z"));
    expect(receiptsBefore.toISOString()).toBe("2021-03-01T00:00:00.000Z");
  });
});
