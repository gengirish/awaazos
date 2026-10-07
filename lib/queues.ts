import { Queue } from "bullmq";
import IORedis from "ioredis";

import { requireEnv } from "@/lib/env";

/**
 * BullMQ requires its own ioredis client with `maxRetriesPerRequest: null`
 * (BullMQ uses blocking commands like BRPOPLPUSH that must not auto-retry).
 * Ratelimit/idempotency run on Vercel over Upstash REST (lib/kv.ts), so this
 * is the only TCP Redis client in the codebase.
 */
let _bullmqRedis: IORedis | null = null;
function getBullMqRedis(): IORedis {
  if (!_bullmqRedis) {
    _bullmqRedis = new IORedis(requireEnv("REDIS_URL"), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    _bullmqRedis.on("error", (err) => {
      console.warn(
        JSON.stringify({
          event: "bullmq_redis_error",
          error: err instanceof Error ? err.message : "unknown",
        }),
      );
    });
  }
  return _bullmqRedis;
}

export type VoiceParseLogJobPayload = {
  vendorId: string;
  transcript: string;
  lang: string;
  sttSource: "webspeech" | "sarvam" | "openai" | "groq" | "nvidia" | "whisper";
  modelUsed: string;
  latencyMs: number;
  itemCount: number;
  confidence: string;
  unmatched: string[];
  escalated: boolean;
};

export type SendReceiptJobPayload = {
  transactionId: string;
  vendorId: string;
  customerPhone: string;
};

export type RetentionRunJobPayload = {
  requestedBy: "cron" | "admin";
  requestedByUserId?: string;
};

let _voiceLogQueue: Queue<VoiceParseLogJobPayload> | null = null;
let _receiptQueue: Queue<SendReceiptJobPayload> | null = null;
let _retentionQueue: Queue<RetentionRunJobPayload> | null = null;

/**
 * Default BullMQ job options applied to every enqueue site:
 *  - 5 attempts with exponential backoff (5s, 10s, 20s, 40s, 80s)
 *  - failed jobs retained for 7 days for debugging via the Bull Board UI
 *  - completed jobs retained at 100 newest for sanity checks
 *
 * Per-call overrides can extend this via the spread at enqueue time.
 */
export const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: 100,
  removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
} as const;

/**
 * BullMQ queue for async VoiceParseLog writes. Lazily connects — do not import
 * this module at top level from Edge routes.
 */
export function getVoiceLogQueue(): Queue<VoiceParseLogJobPayload> {
  if (!_voiceLogQueue) {
    _voiceLogQueue = new Queue<VoiceParseLogJobPayload>("voice-parse-log", {
      connection: getBullMqRedis(),
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
  }
  return _voiceLogQueue;
}

export function getReceiptQueue(): Queue<SendReceiptJobPayload> {
  if (!_receiptQueue) {
    _receiptQueue = new Queue<SendReceiptJobPayload>("send-receipt", {
      connection: getBullMqRedis(),
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
  }
  return _receiptQueue;
}

/** Daily retention maintenance queue (voice logs 90d, receipts 7y). */
export function getRetentionQueue(): Queue<RetentionRunJobPayload> {
  if (!_retentionQueue) {
    _retentionQueue = new Queue<RetentionRunJobPayload>("retention-maintenance", {
      connection: getBullMqRedis(),
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
  }
  return _retentionQueue;
}

/** Exported so workers/index.ts can pass it to Worker constructors (same null-retry rules). */
export function getBullMqConnection(): IORedis {
  return getBullMqRedis();
}
