/**
 * A buyer's rating of one handed-over order. Pure and client-safe;
 * lib/order-feedback-server.ts holds the database side.
 *
 * The comment and who wrote it stay between the buyer and the store. The only
 * thing public is a store's average and count, and only from
 * `PUBLIC_RATING_MIN` ratings, so one unhappy buyer can't define a new store.
 */

export const FEEDBACK_COMMENT_MAX = 500;
export const PUBLIC_RATING_MIN = 5;

/** Words beside the stars, so a rating never depends on colour or counting icons. */
export const RATING_WORDS = ["Poor", "Okay", "Good", "Very good", "Excellent"] as const;

export type RatingSummary = { count: number; sum: number };

/** "4.6": one decimal, in whole tenths. */
export function formatAverageRating({ count, sum }: RatingSummary): string {
  const tenths = Math.round((sum * 10) / count);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export function ratingCountLabel(count: number): string {
  return `${count} ${count === 1 ? "rating" : "ratings"}`;
}

/** The line on the public store page; null until there are enough ratings to mean something. */
export function publicRatingText(summary: RatingSummary): string | null {
  if (summary.count < PUBLIC_RATING_MIN) return null;
  return `${formatAverageRating(summary)} out of 5 · ${ratingCountLabel(summary.count)}`;
}
