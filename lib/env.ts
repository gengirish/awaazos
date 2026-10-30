import { z } from "zod";

/**
 * Environment validation.
 *
 * Boot-required vars (DATABASE_URL, AUTH_SECRET, AUTH_URL) MUST be present at
 * import time; missing them throws and prevents the server from starting.
 *
 * Feature-gated vars (Anthropic, Sarvam, Razorpay, Gupshup, Vercel Blob,
 * Redis) are optional at boot and only validated by the specific lib that
 * needs them. This lets the app build and run in environments where a
 * given integration isn't configured yet (e.g. CI, local Phase 1 dev).
 */
const envSchema = z.object({
  // Boot-required
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),
  AUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z.string().optional(),

  // Feature-gated (validated lazily by their respective integrations)
  ANTHROPIC_API_KEY: z.string().optional(),
  SARVAM_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().startsWith("sk-").optional(),
  GROQ_API_KEY: z.string().startsWith("gsk_").optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // AES-256-GCM key for vendors' own Razorpay credentials (lib/secret-box.ts).
  // Length is validated lazily there, so a bad value can't block boot.
  PAYMENT_KEYS_ENCRYPTION_KEY: z.string().optional(),
  // Web Push (lib/push.ts). Generate once: `npx web-push generate-vapid-keys`.
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(), // "mailto:ops@example.com"
  AGENTMAIL_API_KEY: z.string().optional(),
  AGENTMAIL_INBOX_ID: z.string().optional(),
  GUPSHUP_API_KEY: z.string().optional(),
  GUPSHUP_APP_NAME: z.string().optional(),
  GUPSHUP_SOURCE_NUMBER: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // Read-write token of a separate PRIVATE Blob store for buyers' payment
  // screenshots (lib/payment-proof.ts). Absent → the upload field is hidden.
  PAYMENT_PROOF_BLOB_READ_WRITE_TOKEN: z.string().optional(),
  REDIS_URL: z.string().optional(),
  // Internal demo-store API (lib/internal-auth.ts). Absent or < 32 chars →
  // every /api/internal/* call is 401. Server-side only; never NEXT_PUBLIC_.
  INTERNAL_API_KEY: z.string().optional(),
  // Login of the internal account that owns demo stores until handover.
  DEMO_OWNER_EMAIL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const msg = parsed.error.flatten().fieldErrors;
  throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
}

export const env = {
  ...parsed.data,
  DIRECT_URL: parsed.data.DIRECT_URL ?? parsed.data.DATABASE_URL,
};

/**
 * Helper for feature integrations: assert that a feature-gated env var is
 * present at the time the integration is actually invoked. Throws a clear
 * error rather than silently sending undefined to a third-party SDK.
 */
export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Required environment variable ${String(key)} is not configured`);
  }
  return value as NonNullable<(typeof env)[K]>;
}
