import { z } from "zod";

import { FEEDBACK_COMMENT_MAX } from "@/lib/order-feedback";

/** Apart from lib/order-feedback.ts so the words and limits reach the browser without zod. */
export const orderFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(FEEDBACK_COMMENT_MAX)
    .optional()
    .transform((c) => c || null),
});
