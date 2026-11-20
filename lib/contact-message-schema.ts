import { z } from "zod";

import {
  CONTACT_EMAIL_MAX,
  CONTACT_MESSAGE_MAX,
  CONTACT_MESSAGE_MIN,
  CONTACT_NAME_MAX,
  CONTACT_PHONE_MAX,
} from "@/lib/contact-message";
import { normaliseIndianMobile } from "@/lib/phone";

/** Request body for POST /api/contact. Rules in lib/contact-message.ts. */
export const contactMessageSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name")
    .max(CONTACT_NAME_MAX)
    .transform((s) => s.replace(/\s+/g, " ")),
  email: z.string().trim().max(CONTACT_EMAIL_MAX).email("Enter a valid email address"),
  phone: z
    .string()
    .trim()
    .max(CONTACT_PHONE_MAX)
    .optional()
    .transform((s) => normaliseIndianMobile(s ?? ""))
    .refine((s) => s === "" || /^\+91[6-9]\d{9}$/.test(s), "Enter a 10-digit Indian mobile number"),
  message: z.string().trim().min(CONTACT_MESSAGE_MIN, "Tell us a little more").max(CONTACT_MESSAGE_MAX),
  website: z.string().max(200).optional(),
});
