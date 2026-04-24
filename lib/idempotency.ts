import crypto from "node:crypto";

import { getKv } from "@/lib/kv";

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
 *                  record (status + body).
 *  - "replay"    → prior call already completed. Caller MUST return the cached
 *                  body with HTTP record.status verbatim.
 *  - "in_flight" → concurrent call is mid-flight. Return 409 Conflict.
 *  - "disabled"  → Redis unreachable. Proceed without idempotency (fail-open).
 */
export async function beginIdempotency(args: {
  scope: string;
  vendorId: string;
  idempotencyKey: string;
}): Promise<IdempotencyOutcome> {
  const key = redisKey(args.scope, args.vendorId, args.idempotencyKey);

  const kv = getKv();
  if (!kv) return { kind: "disabled" };

  try {
    // SET NX PX — reserves the slot for 30s; self-heals if caller crashes.
    const reserved = await kv.set(key, "__inflight__", { nx: true, px: 30_000 });

    if (reserved === "OK") {
      return {
        kind: "fresh",
        commit: async (record: IdempotentResponseRecord) => {
          try {
            await kv.set(key, JSON.stringify(record), { ex: TTL_SECONDS });
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

    const existing = await kv.get<string>(key);
    if (existing == null || existing === "__inflight__") {
      return { kind: "in_flight" };
    }
    try {
      const parsed = JSON.parse(existing) as IdempotentResponseRecord;
      return { kind: "replay", record: parsed };
    } catch {
      // Corrupt cache — overwrite and treat as fresh to avoid deadlock.
      await kv.set(key, "__inflight__", { px: 30_000 });
      return {
        kind: "fresh",
        commit: async (record) => {
          await kv.set(key, JSON.stringify(record), { ex: TTL_SECONDS });
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
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}
