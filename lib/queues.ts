import { Queue } from "bullmq";
import IORedis from "ioredis";

import { requireEnv } from "@/lib/env";

export type VoiceParseLogJobPayload = {
  vendorId: string;
  transcript: string;
  lang: string;
  sttSource: "webspeech" | "sarvam";
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

let _redis: IORedis | null = null;
let _voiceLogQueue: Queue<VoiceParseLogJobPayload> | null = null;
let _receiptQueue: Queue<SendReceiptJobPayload> | null = null;

function getRedisConnection(): IORedis {
  if (!_redis) {
    _redis = new IORedis(requireEnv("REDIS_URL"), { maxRetriesPerRequest: null });
  }
  return _redis;
}

/**
 * BullMQ queue for async VoiceParseLog writes. Lazily connects — do not import
 * this module at top level from Edge routes.
 */
export function getVoiceLogQueue(): Queue<VoiceParseLogJobPayload> {
  if (!_voiceLogQueue) {
    _voiceLogQueue = new Queue<VoiceParseLogJobPayload>("voice-parse-log", {
      connection: getRedisConnection(),
    });
  }
  return _voiceLogQueue;
}

export function getReceiptQueue(): Queue<SendReceiptJobPayload> {
  if (!_receiptQueue) {
    _receiptQueue = new Queue<SendReceiptJobPayload>("send-receipt", {
      connection: getRedisConnection(),
    });
  }
  return _receiptQueue;
}
