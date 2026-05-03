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
  NVIDIA_API_KEY: z.string().startsWith("nvapi-").optional(),
  OPENAI_API_KEY: z.string().startsWith("sk-").optional(),
  GROQ_API_KEY: z.string().startsWith("gsk_").optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  GUPSHUP_API_KEY: z.string().optional(),
  GUPSHUP_APP_NAME: z.string().optional(),
  GUPSHUP_SOURCE_NUMBER: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  REDIS_URL: z.string().optional(),
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
