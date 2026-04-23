import type { Plan } from "@prisma/client";

import { getRedis } from "@/lib/redis";

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
  STARTER: 2_000_000,
  PRO: 20_000_000,
  ENTERPRISE: 100_000_000,
};

const SARVAM_VENDOR_MONTHLY_MINUTE_CAP: Record<Plan, number> = {
  FREE: 0,
  STARTER: 1_200,
  PRO: 6_000,
  ENTERPRISE: 20_000,
};

function globalAnthropicCap(): number {
  return Number(process.env.GLOBAL_ANTHROPIC_MONTHLY_TOKEN_CAP ?? 200_000_000);
}

function globalSarvamCap(): number {
  return Number(process.env.GLOBAL_SARVAM_MONTHLY_MINUTE_CAP ?? 100_000);
}

async function bumpCounter(key: string, delta: number, ttlSec: number): Promise<number> {
  const redis = getRedis();
  const next = await redis.incrby(key, delta);
  const ttl = await redis.ttl(key);
  if (ttl < 0) {
    await redis.expire(key, ttlSec);
  }
  return next;
}

/**
 * Reserve Anthropic tokens for this request.
 * Uses approximate prompt+response token estimate.
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
    const [vendorNext, globalNext] = await Promise.all([
      bumpCounter(vendorKey, delta, ttl),
      bumpCounter(globalKey, delta, ttl),
    ]);
    if (vendorNext > ANTHROPIC_VENDOR_MONTHLY_TOKEN_CAP[args.plan]) {
      return { ok: false, code: "vendor_anthropic_cap_reached", message: "Monthly Anthropic cap reached for this plan." };
    }
    if (globalNext > globalAnthropicCap()) {
      return { ok: false, code: "global_anthropic_cap_reached", message: "Platform Anthropic cap reached." };
    }
    return { ok: true };
  } catch {
    // Fail-open to avoid POS outages if Redis is temporarily down.
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
    const [vendorNext, globalNext] = await Promise.all([
      bumpCounter(vendorKey, delta, ttl),
      bumpCounter(globalKey, delta, ttl),
    ]);
    if (vendorNext > SARVAM_VENDOR_MONTHLY_MINUTE_CAP[args.plan]) {
      return { ok: false, code: "vendor_sarvam_cap_reached", message: "Monthly Sarvam minute cap reached for this plan." };
    }
    if (globalNext > globalSarvamCap()) {
      return { ok: false, code: "global_sarvam_cap_reached", message: "Platform Sarvam minute cap reached." };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

