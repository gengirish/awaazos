import { Redis } from "@upstash/redis";

/**
 * Lazily-initialised Upstash Redis HTTP client for Vercel serverless functions.
 *
 * Uses HTTP (REST) not TCP, so it works in every runtime — Node.js serverless,
 * Edge, or long-running processes. Reads UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN from the environment.
 *
 * Returns null if env vars are absent or the client fails to initialise, so
 * every caller MUST implement fail-open semantics.
 *
 * NOTE: BullMQ workers still use ioredis (lib/queues.ts) via REDIS_URL
 * because BullMQ requires a persistent TCP connection.
 */

let _kv: Redis | null = null;
let _initFailed = false;

export function getKv(): Redis | null {
  if (_initFailed) return null;
  if (_kv) return _kv;
  try {
    _kv = Redis.fromEnv();
    return _kv;
  } catch {
    _initFailed = true;
    console.warn(
      JSON.stringify({
        event: "kv_init_failed",
        hint: "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN",
      }),
    );
    return null;
  }
}

/** Test-only escape hatch. Do NOT call from app code. */
export function __setKvForTest(client: Redis | null): void {
  _kv = client;
  _initFailed = false;
}
