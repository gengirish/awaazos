import { describe, expect, it } from "vitest";

import { FEEDBACK_COMMENT_MAX, formatAverageRating, publicRatingText, ratingCountLabel } from "@/lib/order-feedback";
import { orderFeedbackSchema } from "@/lib/order-feedback-schema";

describe("orderFeedbackSchema", () => {
  it("takes 1 to 5 whole stars only", () => {
    for (const rating of [1, 5]) expect(orderFeedbackSchema.safeParse({ rating }).success).toBe(true);
    for (const rating of [0, 6, 4.5, "5", null]) expect(orderFeedbackSchema.safeParse({ rating }).success).toBe(false);
  });

  it("trims the comment and stores a blank one as null", () => {
    expect(orderFeedbackSchema.parse({ rating: 4, comment: "  tasty " }).comment).toBe("tasty");
    expect(orderFeedbackSchema.parse({ rating: 4, comment: "   " }).comment).toBeNull();
    expect(orderFeedbackSchema.parse({ rating: 4 }).comment).toBeNull();
    const tooLong = "x".repeat(FEEDBACK_COMMENT_MAX + 1);
    expect(orderFeedbackSchema.safeParse({ rating: 4, comment: tooLong }).success).toBe(false);
  });
});

describe("store rating", () => {
  it("rounds to one decimal and keeps a whole number's .0", () => {
    expect(formatAverageRating({ count: 3, sum: 14 })).toBe("4.7");
    expect(formatAverageRating({ count: 2, sum: 10 })).toBe("5.0");
    expect(formatAverageRating({ count: 7, sum: 7 })).toBe("1.0");
  });

  it("stays private until there are 5 ratings", () => {
    expect(publicRatingText({ count: 0, sum: 0 })).toBeNull();
    expect(publicRatingText({ count: 4, sum: 20 })).toBeNull();
    expect(publicRatingText({ count: 5, sum: 23 })).toBe("4.6 out of 5 · 5 ratings");
  });

  it("counts in the singular for one", () => {
    expect(ratingCountLabel(1)).toBe("1 rating");
    expect(ratingCountLabel(2)).toBe("2 ratings");
  });
});
