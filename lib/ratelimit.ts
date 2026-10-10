import type { Plan } from "@prisma/client";
import type { NextRequest } from "next/server";

import { getKv } from "@/lib/kv";

/**
 * Sliding-window rate limiter backed by Upstash Redis HTTP client.
 *
 * Algorithm: sorted-set "log of timestamps" evaluated atomically via Lua EVAL.
 *   1. ZREMRANGEBYSCORE — drop entries older than (now - window)
 *   2. ZCARD            — count remaining
 *   3. If count < max   — ZADD this request and allow; else deny
 *
 * Fail-open semantics: any Redis error returns ok=true so a Redis outage
 * never blocks legitimate users (payment-critical product trade-off).
 */

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxReq = tonumber(ARGV[3])
local windowStart = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
local count = redis.call('ZCARD', key)
if count < maxReq then
  redis.call('ZADD', key, now, now .. ':' .. math.random(0, 999999))
  redis.call('PEXPIRE', key, windowMs + 1000)
  return {1, maxReq - count - 1, 0}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local resetAt = (tonumber(oldest[2]) or now) + windowMs
return {0, 0, resetAt}
`.trim();

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Unix epoch ms when the limit will reset */
  resetAt: number;
};

export type Limiter = {
  readonly name: string;
  readonly windowMs: number;
  readonly max: number;
  check(identifier: string): Promise<RateLimitResult>;
};

export function makeLimiter(opts: {
  name: string;
  windowMs: number;
  max: number;
}): Limiter {
  return {
    name: opts.name,
    windowMs: opts.windowMs,
    max: opts.max,
    async check(identifier: string): Promise<RateLimitResult> {
      const key = `rl:${opts.name}:${identifier}`;
      const now = Date.now();
      try {
        const kv = getKv();
        if (!kv) {
          return { ok: true, limit: opts.max, remaining: opts.max, resetAt: now + opts.windowMs };
        }
        const result = await kv.eval<[number, number, number]>(
          SLIDING_WINDOW_LUA,
          [key],
          [now, opts.windowMs, opts.max],
        );
        const r = result as [number, number, number];
        const ok = r[0] === 1;
        const remaining = Number(r[1]);
        const resetAt = ok ? now + opts.windowMs : Number(r[2]) || now + opts.windowMs;
        return { ok, limit: opts.max, remaining, resetAt };
      } catch (err) {
        console.warn(
          JSON.stringify({
            event: "ratelimit_redis_error",
            limiter: opts.name,
            identifier,
            error: err instanceof Error ? err.message : "unknown",
          }),
        );
        return { ok: true, limit: opts.max, remaining: opts.max, resetAt: now + opts.windowMs };
      }
    },
  };
}

/** Pre-configured limiters per protected resource. */

/** 5 attempts per minute per IP — sign-up, sign-in, password reset. */
export const authRateLimit = makeLimiter({
  name: "auth",
  windowMs: 60_000,
  max: 5,
});

const PLAN_AI_LIMITS: Record<Plan, { perMinute: number; burstPerSecond: number }> = {
  FREE: { perMinute: 10, burstPerSecond: 2 },
  STARTER: { perMinute: 30, burstPerSecond: 4 },
  PRO: { perMinute: 120, burstPerSecond: 12 },
  ENTERPRISE: { perMinute: 300, burstPerSecond: 30 },
};

const perMinuteByPlan = new Map<Plan, Limiter>();
const burstByPlan = new Map<Plan, Limiter>();

/** Plan-tier fairness: higher plans get proportionally higher throughput. */
export function getAiLimiterForPlan(plan: Plan): { minute: Limiter; burst: Limiter } {
  let minute = perMinuteByPlan.get(plan);
  let burst = burstByPlan.get(plan);
  if (!minute || !burst) {
    const cfg = PLAN_AI_LIMITS[plan];
    minute = makeLimiter({ name: `ai-${plan.toLowerCase()}-min`, windowMs: 60_000, max: cfg.perMinute });
    burst = makeLimiter({
      name: `ai-${plan.toLowerCase()}-burst`,
      windowMs: 1_000,
      max: cfg.burstPerSecond,
    });
    perMinuteByPlan.set(plan, minute);
    burstByPlan.set(plan, burst);
  }
  return { minute, burst };
}

/** 100 webhook events per source IP per minute — generous for legit gateways. */
export const webhookRateLimit = makeLimiter({
  name: "webhook",
  windowMs: 60_000,
  max: 100,
});

/** 60 mutations per vendor per minute — POST/PUT/DELETE on most routes. */
export const writeRateLimit = makeLimiter({
  name: "write",
  windowMs: 60_000,
  max: 60,
});

/**
 * 5 subscription create/cancel calls per vendor per minute. Each one creates
 * or mutates an object in the platform Razorpay account.
 */
export const billingRateLimit = makeLimiter({
  name: "billing",
  windowMs: 60_000,
  max: 5,
});

/**
 * Best-effort client IP extraction from a Next.js request.
 * Vercel populates x-forwarded-for; falls back to x-real-ip; "unknown"
 * means the limiter buckets all anonymous traffic together (safe default).
 */
export function getClientIp(req: NextRequest | Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") || "unknown";
}

/** Build a 429 JSON response with the standard rate-limit headers. */
export function tooManyRequests(result: RateLimitResult, scope: string): Response {
  const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return new Response(
    JSON.stringify({ error: "rate_limited", scope, retryAfterSec }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    },
  );
}
