/**
 * Golden STT fixture loader.
 *
 * Each fixture references a synthetic audio clip (recorded in-house, no PII)
 * and the transcript we expect ASR to produce. Fixtures align with
 * `tests/golden/parse-order` ids so STT quality gates the same utterances
 * that NLU golden tests exercise.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");
const AUDIO_DIR = path.resolve(__dirname, "audio");

export const sttFixtureSchema = z.object({
  id: z.string().regex(/^[a-z]{2}-\d{3}-[a-z0-9-]+$/),
  lang: z.enum(["en-IN", "hi-IN", "te-IN", "kn-IN", "ta-IN"]),
  audioFile: z.string().min(1),
  expectedTranscript: z.string().min(1),
  minSimilarity: z.number().min(0).max(1).default(0.85),
  parseOrderFixtureId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export type SttFixture = z.infer<typeof sttFixtureSchema>;

export function loadSttFixtures(): SttFixture[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8")) as unknown;
      try {
        return sttFixtureSchema.parse(raw);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new Error(
            `STT fixture ${f} failed validation:\n${err.issues
              .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
              .join("\n")}`,
          );
        }
        throw err;
      }
    });
}

export function audioPathFor(fixture: SttFixture): string {
  return path.resolve(AUDIO_DIR, fixture.audioFile);
}

export function audioExists(fixture: SttFixture): boolean {
  return fs.existsSync(audioPathFor(fixture));
}

export function readAudioBlob(fixture: SttFixture): Blob {
  const abs = audioPathFor(fixture);
  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const type =
    ext === ".wav"
      ? "audio/wav"
      : ext === ".mp3"
        ? "audio/mpeg"
        : "audio/webm";
  return new Blob([buf], { type });
}
