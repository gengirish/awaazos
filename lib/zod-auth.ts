import { StallType } from "@prisma/client";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

import { STALL_TYPE_OTHER_MESSAGE, stallTypeOtherSchema } from "@/lib/stall-type";
import { storeHandleSchema } from "@/lib/store-handle";

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const signUpSchema = z
  .object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(120),
  stallName: z.string().trim().min(1).max(120),
  // The store link (/s/<handle>), chosen by the owner. Omitted → a random
  // suffix on the store name (lib/store-slug.ts), for older clients.
  storeHandle: storeHandleSchema.optional(),
  stallType: z.nativeEnum(StallType),
  // Required when stallType is OTHER ("Pickles & podis"); ignored otherwise.
  stallTypeOther: z.string().max(200).optional(),
  phone: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (val == null || val.trim() === "") return true;
        const parsed = parsePhoneNumberFromString(val.trim(), "IN");
        return Boolean(parsed?.isValid() && parsed.country === "IN");
      },
      { message: "Enter a valid +91 Indian mobile number" },
    ),
  })
  .superRefine((v, ctx) => {
    if (v.stallType === "OTHER" && !stallTypeOtherSchema.safeParse(v.stallTypeOther ?? "").success) {
      ctx.addIssue({ code: "custom", path: ["stallTypeOther"], message: STALL_TYPE_OTHER_MESSAGE });
    }
  });
