import IORedis from "ioredis";

import { requireEnv } from "@/lib/env";

let _redis: IORedis | null = null;

/**
 * Shared, lazily-initialized ioredis singleton. Reused by:
 *  - BullMQ queues (lib/queues.ts)
 *  - Sliding-window rate limiter (lib/ratelimit.ts)
 *  - Idempotency-Key store (lib/idempotency.ts)
 *
 * Reuses REDIS_URL — same Upstash Redis instance provisioned for the worker
 * fleet on Fly.io. No new env var required.
 *
 * Connection failures are logged-and-swallowed — callers (rate limit /
 * idempotency) implement fail-open semantics so a Redis outage degrades
 * gracefully instead of taking the API down.
 */
export function getRedis(): IORedis {
  if (!_redis) {
    _redis = new IORedis(requireEnv("REDIS_URL"), {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      connectTimeout: 5_000,
      commandTimeout: 2_000,
      lazyConnect: false,
      reconnectOnError: (err) => {
        const targetErrors = ["READONLY", "ECONNRESET"];
        return targetErrors.some((t) => err.message.includes(t));
      },
    });
    _redis.on("error", (err) => {
      console.warn(
        JSON.stringify({
          event: "redis_error",
          error: err instanceof Error ? err.message : "unknown",
        }),
      );
    });
  }
  return _redis;
}

/** Test-only escape hatch to inject a mock client. Do NOT call from app code. */
export function __setRedisForTest(client: IORedis | null): void {
  _redis = client;
}
