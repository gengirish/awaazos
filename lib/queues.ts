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

let _redis: IORedis | null = null;
let _voiceLogQueue: Queue<VoiceParseLogJobPayload> | null = null;

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
