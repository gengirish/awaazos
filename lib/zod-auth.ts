import { StallType } from "@prisma/client";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(120),
  stallName: z.string().trim().min(1).max(120),
  stallType: z.nativeEnum(StallType),
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
});
