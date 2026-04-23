import crypto from "node:crypto";

import { getRedis } from "@/lib/redis";

const TTL_SECONDS = 24 * 3600;
const MIN_KEY_LEN = 8;
const MAX_KEY_LEN = 128;

export type IdempotentResponseRecord = {
  status: number;
  body: unknown;
};

export type IdempotencyOutcome =
  | { kind: "fresh"; commit: (record: IdempotentResponseRecord) => Promise<void> }
  | { kind: "replay"; record: IdempotentResponseRecord }
  | { kind: "in_flight" }
  | { kind: "disabled" };

function redisKey(scope: string, vendorId: string, idemKey: string): string {
  // Hash the user-supplied key so client-side typos can't collide with another
  // vendor's keyspace (defense in depth — the scope already isolates by vendor).
  const h = crypto
    .createHash("sha256")
    .update(`${scope}:${vendorId}:${idemKey}`)
    .digest("hex")
    .slice(0, 32);
  return `idem:${scope}:${vendorId}:${h}`;
}

/**
 * Check / reserve an Idempotency-Key for a given scope + vendor.
 *
 * Behaviour:
 *  - "fresh"     → first call. Caller must invoke commit() with the response
 *                  record (status + body). Subsequent calls with the same key
 *                  inside the TTL will replay the cached record.
 *  - "replay"    → a prior call already completed with this key. Caller MUST
 *                  return record.body with HTTP record.status verbatim.
 *  - "in_flight" → a concurrent call is mid-flight (reserved but not yet
 *                  committed). Caller should return 409 Conflict.
 *  - "disabled"  → Redis unreachable. Caller proceeds without idempotency
 *                  (fail-open — same trade-off as ratelimit).
 *
 * Reservation uses SET NX with a short PX so a crash mid-flight self-heals
 * within ~30s. The committed payload then overwrites with the long TTL.
 */
export async function beginIdempotency(args: {
  scope: string;
  vendorId: string;
  idempotencyKey: string;
}): Promise<IdempotencyOutcome> {
  const key = redisKey(args.scope, args.vendorId, args.idempotencyKey);

  let redis: ReturnType<typeof getRedis>;
  try {
    redis = getRedis();
  } catch {
    return { kind: "disabled" };
  }

  try {
    const reserved = await redis.set(key, "__inflight__", "PX", 30_000, "NX");
    if (reserved === "OK") {
      return {
        kind: "fresh",
        commit: async (record: IdempotentResponseRecord) => {
          try {
            await redis.set(key, JSON.stringify(record), "EX", TTL_SECONDS);
          } catch (err) {
            console.warn(
              JSON.stringify({
                event: "idempotency_commit_failed",
                scope: args.scope,
                error: err instanceof Error ? err.message : "unknown",
              }),
            );
          }
        },
      };
    }

    // Reservation didn't go through — read the existing value
    const existing = await redis.get(key);
    if (existing == null || existing === "__inflight__") {
      return { kind: "in_flight" };
    }
    try {
      const parsed = JSON.parse(existing) as IdempotentResponseRecord;
      return { kind: "replay", record: parsed };
    } catch {
      // Corrupt cache — treat as fresh so we don't deadlock; overwrite TTL.
      await redis.set(key, "__inflight__", "PX", 30_000);
      return {
        kind: "fresh",
        commit: async (record) => {
          await redis.set(key, JSON.stringify(record), "EX", TTL_SECONDS);
        },
      };
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "idempotency_redis_error",
        scope: args.scope,
        error: err instanceof Error ? err.message : "unknown",
      }),
    );
    return { kind: "disabled" };
  }
}

/** Read Idempotency-Key from request headers; returns null if missing or invalid. */
export function getIdempotencyKey(req: Request): string | null {
  const raw = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length < MIN_KEY_LEN || trimmed.length > MAX_KEY_LEN) return null;
  // Allowed charset: alphanumeric, hyphen, underscore. Prevents header smuggling.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}
