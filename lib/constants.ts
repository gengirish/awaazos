import type { Plan, StallType } from "@prisma/client";

/** SaaS plan limits — enforce server-side in API routes (see PROMPT 9). */
export const PLAN_LIMITS: Record<
  Plan,
  {
    label: string;
    pricePaise: number;
    txnPerMonth: number | null;
    maxStaff: number | null;
    whatsappReceipts: boolean;
    razorpayLinks: boolean;
    monthlyTxnCap: number | null;
    whatsapp: boolean;
    csvExport: boolean;
    sarvamStt: boolean;
    analyticsDays: number;
  }
> = {
  FREE: {
    label: "Free",
    pricePaise: 0,
    txnPerMonth: 50,
    maxStaff: 1,
    whatsappReceipts: false,
    razorpayLinks: false,
    monthlyTxnCap: 50,
    whatsapp: false,
    csvExport: false,
    sarvamStt: false,
    analyticsDays: 7,
  },
  STARTER: {
    label: "Starter",
    pricePaise: 29900,
    txnPerMonth: 500,
    maxStaff: 3,
    whatsappReceipts: true,
    razorpayLinks: false,
    monthlyTxnCap: 500,
    whatsapp: true,
    csvExport: false,
    sarvamStt: true,
    analyticsDays: 90,
  },
  PRO: {
    label: "Pro",
    pricePaise: 79900,
    txnPerMonth: null,
    maxStaff: null,
    whatsappReceipts: true,
    razorpayLinks: true,
    monthlyTxnCap: null,
    whatsapp: true,
    csvExport: true,
    sarvamStt: true,
    analyticsDays: 365,
  },
  ENTERPRISE: {
    label: "Enterprise",
    pricePaise: 0,
    txnPerMonth: null,
    maxStaff: null,
    whatsappReceipts: true,
    razorpayLinks: true,
    monthlyTxnCap: null,
    whatsapp: true,
    csvExport: true,
    sarvamStt: true,
    analyticsDays: 365,
  },
};

export const STALL_TYPES: { value: StallType; label: string }[] = [
  { value: "GENERAL", label: "General" },
  { value: "FOOD_BEVERAGE", label: "Food & beverage" },
  { value: "STREET_FOOD", label: "Street food" },
  { value: "CARNIVAL", label: "Carnival / mela" },
  { value: "SCHOOL_CANTEEN", label: "School canteen" },
  { value: "EVENT_POPUP", label: "Event pop-up" },
  { value: "KIRANA", label: "Kirana / grocery" },
  { value: "CLOTHING", label: "Clothing" },
  { value: "SERVICES", label: "Services" },
];

/**
 * Voice languages exposed in the user-facing picker (onboarding/settings).
 *
 * Intentionally restricted to en-IN + hi-IN for the YC pitch — these are the
 * two locales where the Claude → Sarvam → cart pipeline is end-to-end solid.
 *
 * STT capability for te-IN / kn-IN / ta-IN is preserved in `hooks/useVoiceOrder.ts`
 * (SARVAM_LANGS / WEBSPEECH_LANGS) and `lib/sarvam.ts` — they're just not surfaced
 * in the picker. If a vendor has an older stored preference like `te-IN`, the
 * picker normalises the rendered value to `hi-IN` while leaving the DB row
 * untouched (see onboarding page for the `displayVoiceLang` derivation).
 */
export const VOICE_LANGUAGES = [
  { value: "en-IN", label: "English" },
  { value: "hi-IN", label: "हिन्दी (Hindi)" },
] as const;

/** Allowed picker values — used to normalise stale stored preferences at render time. */
export const ALLOWED_VOICE_LANGS = VOICE_LANGUAGES.map((l) => l.value) as readonly string[];

/** Brand tokens aligned with tailwind `brand.*` and VendorSettings.theme. */
export const BRAND = {
  primary: "#FF6B00",
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
  blue: "#2563eb",
  purple: "#7c3aed",
} as const;

/** Per-plan SaaS price in paise (monthly). Mirrors `PLAN_LIMITS.*.pricePaise` for gates and marketing. */
export const PLAN_PRICES_PAISE: Record<Plan, number> = {
  FREE: 0,
  STARTER: 29900,
  PRO: 79900,
  ENTERPRISE: 0,
};

/** Plan ordering for subscription gates (higher = better). */
export const PLAN_RANK: Record<Plan, number> = {
  FREE: 0,
  STARTER: 1,
  PRO: 2,
  ENTERPRISE: 3,
};
