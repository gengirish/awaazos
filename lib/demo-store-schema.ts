/**
 * Request validation for the internal demo-store API (server half:
 * lib/demo-store.ts, docs: docs/INTERNAL_DEMO_STORES.md). Pure, no Prisma.
 *
 * The body is snake_case because the caller is an outreach workflow, not our
 * own client. Every object is `.strict()`, so an unexpected key is a 400, and
 * `findForbiddenPaymentField` runs first so a request carrying a UPI id, bank
 * details or payment keys is refused by name rather than as "unknown key".
 * A demo store's UPI id is always DEMO_UPI_ID.
 */
import type { StallType } from "@prisma/client";
import { z } from "zod";

import { STORE_NAME_MAX } from "@/lib/store-name";

export const DEMO_UPI_ID = "demo@upi";
export const DEMO_NAME_SUFFIX = " (DEMO)";
export const DEMO_CLAIM_TTL_DAYS = 7;
export const DEMO_CREATES_PER_DAY = 20;

/** Only reserved-looking numbers: 91 99999 xxxxx, with or without "+". */
export const SAMPLE_PHONE_PATTERN = /^\+?9199999\d{5}$/;

/** Same ceiling as the voice menu builder (lib/parse-menu.ts): ₹1,00,000. */
export const DEMO_MAX_PRICE_PAISE = 10_000_000;
const MAX_ITEMS = 100;
const MAX_ORDERS = 50;
const MAX_LINE_QTY = 99;

/** Outreach category → StallType. Every kitchen kind maps to FOOD_BEVERAGE. */
export const DEMO_CATEGORIES = {
  home_bakery: "FOOD_BEVERAGE",
  home_kitchen: "FOOD_BEVERAGE",
  cloud_kitchen: "FOOD_BEVERAGE",
  cafe: "FOOD_BEVERAGE",
  sweets: "FOOD_BEVERAGE",
  catering: "FOOD_BEVERAGE",
  street_food: "STREET_FOOD",
  general: "GENERAL",
} as const satisfies Record<string, StallType>;

type DemoCategory = keyof typeof DEMO_CATEGORIES;

/** Voice languages the store may use; only en/hi are offered in the app today. */
const LANGS = ["en", "hi", "te", "kn", "ta"] as const;
export const ACTIVE_VOICE_LANG: Partial<Record<(typeof LANGS)[number], string>> = { en: "en-IN", hi: "hi-IN" };

// ─── Payment-credential guard ──────────────────────────────────────

/** Key names that would carry payment details. Matched on the whole key, any depth. */
const FORBIDDEN_KEY = /(upi|vpa|bank|ifsc|account|razorpay|card|iban|swift|password|secret|token|api_?key)/i;
/** A UPI id ("name@okaxis"). "@handle" (nothing before the @) is an Instagram handle, not a VPA. */
const VPA_VALUE = /[a-z0-9._-]{2,}@[a-z][a-z0-9]{1,}/i;

/**
 * The path of the first key or value that looks like payment credentials, or
 * null. Runs on the raw JSON before schema parsing.
 */
export function findForbiddenPaymentField(value: unknown, path: string[] = []): string | null {
  if (typeof value === "string") {
    return VPA_VALUE.test(value) ? path.join(".") || "(body)" : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findForbiddenPaymentField(value[i], [...path, String(i)]);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(k)) return [...path, k].join(".");
      const hit = findForbiddenPaymentField(v, [...path, k]);
      if (hit) return hit;
    }
  }
  return null;
}

// ─── Schemas ────────────────────────────────────────────────────────

const paise = (max: number) => z.number().int("must be whole paise").min(0).max(max);

export const externalRefSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{2,79}$/, "lowercase letters, digits and dashes, 3–80 characters");

const itemSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    unit: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9 .]{0,15}$/i, "a short unit such as kg, piece, box")
      .optional(),
    price_paise: paise(DEMO_MAX_PRICE_PAISE).refine((n) => n > 0, "must be more than 0"),
    category: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const orderSchema = z
  .object({
    customer_name: z.string().trim().min(1).max(60),
    customer_phone: z.string().trim().regex(SAMPLE_PHONE_PATTERN, "sample phones must be 9199999xxxxx"),
    lines: z
      .array(z.object({ item: z.string().trim().min(1).max(80), qty: z.number().int().min(1).max(MAX_LINE_QTY) }).strict())
      .min(1)
      .max(20),
    event_date: z.string().datetime({ offset: true }).optional(),
    advance_paid_paise: paise(DEMO_MAX_PRICE_PAISE * MAX_LINE_QTY).default(0),
    status: z.enum(["placed", "confirmed", "delivered", "cancelled"]).default("placed"),
  })
  .strict();

export const demoStoreCreateSchema = z
  .object({
    external_ref: externalRefSchema,
    profile: z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(STORE_NAME_MAX - DEMO_NAME_SUFFIX.length),
        category: z.enum(Object.keys(DEMO_CATEGORIES) as [DemoCategory, ...DemoCategory[]]).default("general"),
        area: z.string().trim().min(1).max(120).optional(),
        instagram: z.string().trim().min(1).max(120).optional(),
        display_phone: z
          .string()
          .trim()
          .regex(/^\+?(91)?[6-9]\d{9}$/, "an Indian mobile number")
          .optional(),
        languages: z.array(z.enum(LANGS)).min(1).max(5).default(["en"]),
      })
      .strict(),
    items: z.array(itemSchema).min(1).max(MAX_ITEMS),
    sample_orders: z.array(orderSchema).max(MAX_ORDERS).default([]),
  })
  .strict()
  .superRefine((body, ctx) => {
    const prices = new Map<string, number>();
    body.items.forEach((item, i) => {
      const key = itemKey(item.name);
      if (prices.has(key)) {
        ctx.addIssue({ code: "custom", path: ["items", i, "name"], message: "duplicate item name" });
      }
      prices.set(key, item.price_paise);
    });
    body.sample_orders.forEach((order, o) => {
      let total = 0;
      order.lines.forEach((line, l) => {
        const price = prices.get(itemKey(line.item));
        if (price === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["sample_orders", o, "lines", l, "item"],
            message: "not one of the items in this request",
          });
          return;
        }
        total += price * line.qty;
      });
      if (order.advance_paid_paise > total) {
        ctx.addIssue({
          code: "custom",
          path: ["sample_orders", o, "advance_paid_paise"],
          message: "more than the order total",
        });
      }
    });
  });

export type DemoStoreCreateInput = z.infer<typeof demoStoreCreateSchema>;
export type DemoSampleOrderInput = DemoStoreCreateInput["sample_orders"][number];

export const demoHandoverSchema = z.object({ owner_email: z.string().trim().toLowerCase().email().max(254) }).strict();

/** Items are matched by name, trimmed and case-insensitive. */
export function itemKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The voice language a demo store gets: the first requested one the app offers, else English. */
export function demoVoiceLang(languages: readonly string[]): string {
  for (const l of languages) {
    const v = ACTIVE_VOICE_LANG[l as keyof typeof ACTIVE_VOICE_LANG];
    if (v) return v;
  }
  return "en-IN";
}

/** What the store header and app shell show: "Prankie's Bakery (DEMO)". The stored name stays clean. */
export function displayStoreName(store: { name: string; isDemo: boolean }): string {
  return store.isDemo ? `${store.name}${DEMO_NAME_SUFFIX}` : store.name;
}
