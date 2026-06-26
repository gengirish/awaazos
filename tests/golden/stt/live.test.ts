import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: (key: string): string => {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Required environment variable ${key} is not configured`);
    }
    return value;
  },
  env: new Proxy({} as Record<string, string | undefined>, {
    get: (_t, key: string) => process.env[key],
  }),
}));

import {
  dispatchSttProvider,
  isSttProviderConfigured,
  langSupportedByProvider,
  resolveSttProvidersFromEnv,
  SttProviderNotConfiguredError,
  type SttProvider,
} from "./driver";
import {
  audioExists,
  loadSttFixtures,
  readAudioBlob,
  type SttFixture,
} from "./fixtures";
import {
  compareTranscripts,
  formatTranscriptDiff,
  type TranscriptDiff,
} from "./transcript-equality";

/**
 * Live golden STT runner — hits real ASR APIs or self-hosted Whisper.
 *
 * Gated by GOLDEN_STT_LIVE=1. Requires audio clips in tests/golden/stt/audio/.
 *
 *   GOLDEN_STT_PROVIDERS=groq,whisper npm run test:golden:stt
 */

const LIVE_ENABLED = process.env.GOLDEN_STT_LIVE === "1";
const RUN_DIR = path.resolve(__dirname, ".last-run");

interface SttOutcome {
  fixture: SttFixture;
  provider: SttProvider;
  ok: boolean;
  skipped: boolean;
  reason?: string;
  latencyMs?: number;
  diff?: TranscriptDiff;
  actualTranscript?: string;
}

const outcomes: SttOutcome[] = [];

async function runFixture(provider: SttProvider, fx: SttFixture): Promise<SttOutcome> {
  if (!audioExists(fx)) {
    return { fixture: fx, provider, ok: false, skipped: true, reason: "missing_audio" };
  }
  if (!langSupportedByProvider(provider, fx.lang)) {
    return { fixture: fx, provider, ok: false, skipped: true, reason: "lang_unsupported" };
  }
  if (!isSttProviderConfigured(provider)) {
    return { fixture: fx, provider, ok: false, skipped: true, reason: "not_configured" };
  }

  try {
    const audio = readAudioBlob(fx);
    const run = await dispatchSttProvider(provider, audio, fx.lang);
    const diff = compareTranscripts(
      fx.expectedTranscript,
      run.transcript,
      fx.minSimilarity,
    );
    return {
      fixture: fx,
      provider,
      ok: diff.pass,
      skipped: false,
      latencyMs: run.latencyMs,
      diff,
      actualTranscript: run.transcript,
    };
  } catch (err) {
    if (err instanceof SttProviderNotConfiguredError) {
      return { fixture: fx, provider, ok: false, skipped: true, reason: "not_configured" };
    }
    return {
      fixture: fx,
      provider,
      ok: false,
      skipped: false,
      reason: err instanceof Error ? err.message : "unknown_error",
    };
  }
}

function writeDiff(outcome: SttOutcome) {
  if (!outcome.diff || outcome.ok) return;
  const dir = path.join(RUN_DIR, outcome.provider);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${outcome.fixture.id}.diff.json`),
    JSON.stringify(
      {
        fixtureId: outcome.fixture.id,
        lang: outcome.fixture.lang,
        expected: outcome.diff.expectedNormalized,
        actual: outcome.diff.actualNormalized,
        similarity: outcome.diff.similarity,
        minSimilarity: outcome.diff.minSimilarity,
        actualTranscript: outcome.actualTranscript,
      },
      null,
      2,
    ),
  );
}

function writeSummary() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const byProvider = new Map<SttProvider, SttOutcome[]>();
  for (const o of outcomes) {
    const list = byProvider.get(o.provider) ?? [];
    list.push(o);
    byProvider.set(o.provider, list);
  }

  const summary: Record<string, unknown> = {};
  for (const [provider, list] of Array.from(byProvider.entries())) {
    const ran = list.filter((o: SttOutcome) => !o.skipped);
    const passed = ran.filter((o: SttOutcome) => o.ok);
    const latencies = ran.map((o: SttOutcome) => o.latencyMs ?? 0).sort((a, b) => a - b);
    summary[provider] = {
      total: list.length,
      skipped: list.filter((o: SttOutcome) => o.skipped).length,
      ran: ran.length,
      passed: passed.length,
      passRate: ran.length ? passed.length / ran.length : 0,
      p50Ms: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
      p95Ms: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
    };
  }
  fs.writeFileSync(path.join(RUN_DIR, "summary.json"), JSON.stringify(summary, null, 2));
}

const skipRoot = !LIVE_ENABLED;

describe.skipIf(skipRoot)("golden stt: LIVE", () => {
  const fixtures = loadSttFixtures();
  const providers = resolveSttProvidersFromEnv();

  it("has at least one configured provider", () => {
    const configured = providers.filter(isSttProviderConfigured);
    expect(
      configured.length,
      `No STT providers configured. Set API keys or WHISPER_STT_URL. Requested: ${providers.join(", ")}`,
    ).toBeGreaterThan(0);
  });

  for (const provider of resolveSttProvidersFromEnv()) {
    describe(`provider: ${provider}`, () => {
      for (const fx of fixtures) {
        it(fx.id, async () => {
          const outcome = await runFixture(provider, fx);
          outcomes.push(outcome);
          if (outcome.skipped) {
            if (outcome.reason === "missing_audio") {
              console.log(`SKIP ${fx.id}: audio missing (${fx.audioFile})`);
              return;
            }
            console.log(`SKIP ${fx.id}: ${outcome.reason}`);
            return;
          }
          writeDiff(outcome);
          if (!outcome.ok && outcome.diff) {
            expect.fail(formatTranscriptDiff(outcome.diff));
          }
          expect(outcome.ok).toBe(true);
        });
      }
    });
  }

  afterAll(() => {
    if (outcomes.length > 0) writeSummary();
  });
});

describe("golden stt: live runner placeholder", () => {
  it("documents how to run live STT golden tests", () => {
    if (LIVE_ENABLED) return;
    expect(
      "Set GOLDEN_STT_LIVE=1 and record audio clips under tests/golden/stt/audio/, then npm run test:golden:stt",
    ).toBeTruthy();
  });
});
