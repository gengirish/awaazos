import type { Plan } from "@prisma/client";

import { PLAN_LIMITS } from "@/lib/constants";
import { getKv } from "@/lib/kv";

type GuardResult = { ok: true } | { ok: false; code: string; message: string };

function monthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function secondsUntilMonthEnd(date = new Date()): number {
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return Math.max(60, Math.ceil((end.getTime() - date.getTime()) / 1000));
}

const ANTHROPIC_VENDOR_MONTHLY_TOKEN_CAP: Record<Plan, number> = {
  FREE: 100_000,
  LITE: 100_000,
  STARTER: 2_000_000,
  PRO: 20_000_000,
  ENTERPRISE: 100_000_000,
};

const SARVAM_VENDOR_MONTHLY_MINUTE_CAP: Record<Plan, number> = {
  FREE: 0,
  LITE: 0,
  STARTER: 1_200,
  PRO: 6_000,
  ENTERPRISE: 20_000,
};

const OPENAI_STT_VENDOR_MONTHLY_MINUTE_CAP: Record<Plan, number> = {
  FREE: 0,
  LITE: 0,
  STARTER: 1_200,
  PRO: 6_000,
  ENTERPRISE: 20_000,
};

// Groq Whisper is ~⅛ the cost of OpenAI mini, so per-vendor caps are
// proportionally larger. These are still defensive ceilings rather than
// expected steady-state usage — Groq is layer-2, only fires when primary
// fails or trips its breaker.
const GROQ_STT_VENDOR_MONTHLY_MINUTE_CAP: Record<Plan, number> = {
  FREE: 0,
  LITE: 0,
  STARTER: 2_400,
  PRO: 12_000,
  ENTERPRISE: 40_000,
};

function globalFalImageCap(): number {
  return Number(process.env.GLOBAL_FAL_MONTHLY_IMAGE_CAP ?? 3_000);
}

function globalAnthropicCap(): number {
  return Number(process.env.GLOBAL_ANTHROPIC_MONTHLY_TOKEN_CAP ?? 200_000_000);
}

function globalSarvamCap(): number {
  return Number(process.env.GLOBAL_SARVAM_MONTHLY_MINUTE_CAP ?? 100_000);
}

function globalOpenaiSttCap(): number {
  return Number(process.env.GLOBAL_OPENAI_STT_MONTHLY_MINUTE_CAP ?? 50_000);
}

function globalGroqSttCap(): number {
  return Number(process.env.GLOBAL_GROQ_STT_MONTHLY_MINUTE_CAP ?? 200_000);
}

async function bumpCounter(key: string, delta: number, ttlSec: number): Promise<number> {
  const kv = getKv();
  if (!kv) return 0;
  const next = await kv.incrby(key, delta);
  const ttl = await kv.ttl(key);
  if (ttl < 0) {
    await kv.expire(key, ttlSec);
  }
  return next;
}

async function unbumpCounter(key: string, delta: number): Promise<void> {
  const kv = getKv();
  if (!kv) return;
  try {
    await kv.incrby(key, -delta);
  } catch {
    /* fail-open */
  }
}

/**
 * Reserve Anthropic tokens for this request.
 * Uses approximate prompt+response token estimate.
 * Fail-open: if Redis is down, the check passes to avoid POS outages.
 */
export async function reserveAnthropicTokens(args: {
  vendorId: string;
  plan: Plan;
  estimatedTokens: number;
}): Promise<GuardResult> {
  const delta = Math.max(1, Math.floor(args.estimatedTokens));
  const m = monthKey();
  const ttl = secondsUntilMonthEnd();

  const vendorKey = `usage:anthropic:vendor:${args.vendorId}:${m}`;
  const globalKey = `usage:anthropic:global:${m}`;

  try {
    const kv = getKv();
    if (!kv) return { ok: true };

    const vendorNext = await bumpCounter(vendorKey, delta, ttl);
    if (vendorNext > ANTHROPIC_VENDOR_MONTHLY_TOKEN_CAP[args.plan]) {
      return {
        ok: false,
        code: "vendor_anthropic_cap_reached",
        message: "Monthly Anthropic cap reached for this plan.",
      };
    }
    const globalNext = await bumpCounter(globalKey, delta, ttl);
    if (globalNext > globalAnthropicCap()) {
      await unbumpCounter(vendorKey, delta);
      return { ok: false, code: "global_anthropic_cap_reached", message: "Platform Anthropic cap reached." };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** Reserve Sarvam usage in whole minutes (rounded up). */
export async function reserveSarvamMinutes(args: {
  vendorId: string;
  plan: Plan;
  estimatedMinutes: number;
}): Promise<GuardResult> {
  const delta = Math.max(1, Math.ceil(args.estimatedMinutes));
  const m = monthKey();
  const ttl = secondsUntilMonthEnd();
  const vendorKey = `usage:sarvam:vendor:${args.vendorId}:${m}`;
  const globalKey = `usage:sarvam:global:${m}`;

  try {
    const kv = getKv();
    if (!kv) return { ok: true };

    const vendorNext = await bumpCounter(vendorKey, delta, ttl);
    if (vendorNext > SARVAM_VENDOR_MONTHLY_MINUTE_CAP[args.plan]) {
      return {
        ok: false,
        code: "vendor_sarvam_cap_reached",
        message: "Monthly Sarvam minute cap reached for this plan.",
      };
    }
    const globalNext = await bumpCounter(globalKey, delta, ttl);
    if (globalNext > globalSarvamCap()) {
      await unbumpCounter(vendorKey, delta);
      return { ok: false, code: "global_sarvam_cap_reached", message: "Platform Sarvam minute cap reached." };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

export async function releaseSarvamMinutes(args: {
  vendorId: string;
  estimatedMinutes: number;
}): Promise<void> {
  const delta = Math.max(1, Math.ceil(args.estimatedMinutes));
  const m = monthKey();
  const vendorKey = `usage:sarvam:vendor:${args.vendorId}:${m}`;
  const globalKey = `usage:sarvam:global:${m}`;
  await Promise.all([unbumpCounter(vendorKey, delta), unbumpCounter(globalKey, delta)]);
}

/** Reserve OpenAI STT usage in whole minutes (rounded up). */
export async function reserveOpenaiSttMinutes(args: {
  vendorId: string;
  plan: Plan;
  estimatedMinutes: number;
}): Promise<GuardResult> {
  const delta = Math.max(1, Math.ceil(args.estimatedMinutes));
  const m = monthKey();
  const ttl = secondsUntilMonthEnd();
  const vendorKey = `usage:openai-stt:vendor:${args.vendorId}:${m}`;
  const globalKey = `usage:openai-stt:global:${m}`;

  try {
    const kv = getKv();
    if (!kv) return { ok: true };

    const vendorNext = await bumpCounter(vendorKey, delta, ttl);
    if (vendorNext > OPENAI_STT_VENDOR_MONTHLY_MINUTE_CAP[args.plan]) {
      return {
        ok: false,
        code: "vendor_openai_stt_cap_reached",
        message: "Monthly OpenAI STT minute cap reached for this plan.",
      };
    }
    const globalNext = await bumpCounter(globalKey, delta, ttl);
    if (globalNext > globalOpenaiSttCap()) {
      await unbumpCounter(vendorKey, delta);
      return {
        ok: false,
        code: "global_openai_stt_cap_reached",
        message: "Platform OpenAI STT minute cap reached.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

export async function releaseOpenaiSttMinutes(args: {
  vendorId: string;
  estimatedMinutes: number;
}): Promise<void> {
  const delta = Math.max(1, Math.ceil(args.estimatedMinutes));
  const m = monthKey();
  const vendorKey = `usage:openai-stt:vendor:${args.vendorId}:${m}`;
  const globalKey = `usage:openai-stt:global:${m}`;
  await Promise.all([unbumpCounter(vendorKey, delta), unbumpCounter(globalKey, delta)]);
}

/**
 * Reserve one AI image. Unlike the guards around it this fails CLOSED in
 * production: every call is billed and no sale depends on it, so an unmetered
 * image is worse than a "try again later". Without KV in dev it passes.
 */
export async function reserveFalImage(args: { vendorId: string; plan: Plan }): Promise<GuardResult> {
  const unavailable: GuardResult = {
    ok: false,
    code: "fal_guard_unavailable",
    message: "Usage metering is unavailable.",
  };
  if (!getKv()) return process.env.NODE_ENV === "production" ? unavailable : { ok: true };

  const m = monthKey();
  const ttl = secondsUntilMonthEnd();
  const vendorKey = `usage:fal-image:vendor:${args.vendorId}:${m}`;
  const globalKey = `usage:fal-image:global:${m}`;

  try {
    const vendorNext = await bumpCounter(vendorKey, 1, ttl);
    if (vendorNext > PLAN_LIMITS[args.plan].aiImagesPerMonth) {
      await unbumpCounter(vendorKey, 1);
      return { ok: false, code: "vendor_fal_image_cap_reached", message: "Monthly AI image cap reached for this plan." };
    }
    const globalNext = await bumpCounter(globalKey, 1, ttl);
    if (globalNext > globalFalImageCap()) {
      await Promise.all([unbumpCounter(vendorKey, 1), unbumpCounter(globalKey, 1)]);
      return { ok: false, code: "global_fal_image_cap_reached", message: "Platform AI image cap reached." };
    }
    return { ok: true };
  } catch {
    return unavailable;
  }
}

export async function releaseFalImage(args: { vendorId: string }): Promise<void> {
  const m = monthKey();
  await Promise.all([
    unbumpCounter(`usage:fal-image:vendor:${args.vendorId}:${m}`, 1),
    unbumpCounter(`usage:fal-image:global:${m}`, 1),
  ]);
}

/** Reserve Groq STT usage in whole minutes (rounded up). */
export async function reserveGroqSttMinutes(args: {
  vendorId: string;
  plan: Plan;
  estimatedMinutes: number;
}): Promise<GuardResult> {
  const delta = Math.max(1, Math.ceil(args.estimatedMinutes));
  const m = monthKey();
  const ttl = secondsUntilMonthEnd();
  const vendorKey = `usage:groq-stt:vendor:${args.vendorId}:${m}`;
  const globalKey = `usage:groq-stt:global:${m}`;

  try {
    const kv = getKv();
    if (!kv) return { ok: true };

    const vendorNext = await bumpCounter(vendorKey, delta, ttl);
    if (vendorNext > GROQ_STT_VENDOR_MONTHLY_MINUTE_CAP[args.plan]) {
      return {
        ok: false,
        code: "vendor_groq_stt_cap_reached",
        message: "Monthly Groq STT minute cap reached for this plan.",
      };
    }
    const globalNext = await bumpCounter(globalKey, delta, ttl);
    if (globalNext > globalGroqSttCap()) {
      await unbumpCounter(vendorKey, delta);
      return {
        ok: false,
        code: "global_groq_stt_cap_reached",
        message: "Platform Groq STT minute cap reached.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

export async function releaseGroqSttMinutes(args: {
  vendorId: string;
  estimatedMinutes: number;
}): Promise<void> {
  const delta = Math.max(1, Math.ceil(args.estimatedMinutes));
  const m = monthKey();
  const vendorKey = `usage:groq-stt:vendor:${args.vendorId}:${m}`;
  const globalKey = `usage:groq-stt:global:${m}`;
  await Promise.all([unbumpCounter(vendorKey, delta), unbumpCounter(globalKey, delta)]);
}
