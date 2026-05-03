import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

// `lib/env.ts` validates AUTH_SECRET / DATABASE_URL at import time and throws
// when missing. The live test transitively imports `lib/anthropic` which
// pulls in `lib/env`, so without this mock Vitest's collection phase fails
// in CI environments that don't have those server-only secrets set.
//
// requireEnv is a passthrough that reads process.env at CALL time — so when
// GOLDEN_PARSE_ORDER_LIVE=1 and the user has a real .env.local loaded, the
// real ANTHROPIC_API_KEY still flows through.
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

import { compareCarts, formatDiff, type CartDiff } from "./cart-equality";
import {
  ALL_PROVIDERS,
  dispatchProvider,
  isImplemented,
  ProviderNotImplementedError,
  resolveProvidersFromEnv,
  type ParseProvider,
  type ProviderRunResult,
} from "./driver";
import {
  loadFixtures,
  loadMenu,
  menuForParse,
  type Fixture,
} from "./fixtures";

/**
 * Live golden-test runner. Hits the real LLM — costs ~₹2-5 per provider per
 * full run depending on token volume.
 *
 * Gated by GOLDEN_PARSE_ORDER_LIVE=1. Without that flag the suite no-ops, so
 * CI never accidentally bills the company every push.
 *
 * Provider selection (env, in priority order):
 *   GOLDEN_PARSE_ORDER_PROVIDERS=claude-haiku,claude-sonnet
 *   GOLDEN_PARSE_ORDER_PROVIDER=claude-haiku
 *   (default = claude-haiku)
 *
 * On a non-pass, the diff is written to:
 *   tests/golden/parse-order/.last-run/<provider>/<fixture-id>.diff.json
 * (gitignored). Inspect those after a calibration run to decide whether
 * to widen tolerances, fix the prompt, or reject the provider.
 */

const LIVE_ENABLED = process.env.GOLDEN_PARSE_ORDER_LIVE === "1";
const RUN_DIR = path.resolve(__dirname, ".last-run");

interface FixtureOutcome {
  fixture: Fixture;
  provider: ParseProvider;
  ok: boolean;
  skipped: boolean;
  reason?: string;
  latencyMs?: number;
  diff?: CartDiff;
}

const outcomes: FixtureOutcome[] = [];

async function runFixture(
  provider: ParseProvider,
  fx: Fixture,
  menu: ReturnType<typeof loadMenu>,
): Promise<FixtureOutcome> {
  if (!isImplemented(provider)) {
    return {
      fixture: fx,
      provider,
      ok: false,
      skipped: true,
      reason: `provider not yet wired into harness`,
    };
  }
  let runResult: ProviderRunResult;
  try {
    runResult = await dispatchProvider(provider, menuForParse(menu), fx.transcript, fx.lang);
  } catch (err) {
    if (err instanceof ProviderNotImplementedError) {
      return { fixture: fx, provider, ok: false, skipped: true, reason: err.message };
    }
    return {
      fixture: fx,
      provider,
      ok: false,
      skipped: false,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
  const diff = compareCarts(fx.expected, runResult.result);
  return {
    fixture: fx,
    provider,
    ok: diff.pass,
    skipped: false,
    latencyMs: runResult.latencyMs,
    diff,
  };
}

function writeDiffArtifact(outcome: FixtureOutcome): void {
  if (!outcome.diff || outcome.skipped || outcome.ok) return;
  const dir = path.join(RUN_DIR, outcome.provider);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${outcome.fixture.id}.diff.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        fixture: outcome.fixture,
        diff: outcome.diff,
        latencyMs: outcome.latencyMs,
      },
      null,
      2,
    ),
  );
}

function summarize(provider: ParseProvider): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  p50: number;
  p95: number;
} {
  const rows = outcomes.filter((o) => o.provider === provider);
  const latencies = rows
    .map((r) => r.latencyMs)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);
  function pct(p: number): number {
    if (latencies.length === 0) return 0;
    return latencies[Math.min(latencies.length - 1, Math.floor((latencies.length * p) / 100))];
  }
  return {
    total: rows.length,
    passed: rows.filter((r) => r.ok).length,
    failed: rows.filter((r) => !r.ok && !r.skipped).length,
    skipped: rows.filter((r) => r.skipped).length,
    p50: pct(50),
    p95: pct(95),
  };
}

const skipRoot = !LIVE_ENABLED;

describe.skipIf(skipRoot)("golden parse-order: LIVE", () => {
  const menu = loadMenu();
  const fixtures = loadFixtures();
  const providers = resolveProvidersFromEnv();

  if (providers.length === 0) {
    it("aborts when no valid provider is selected", () => {
      throw new Error(
        `No valid provider in GOLDEN_PARSE_ORDER_PROVIDER(S). Known: ${ALL_PROVIDERS.join(", ")}`,
      );
    });
    return;
  }

  for (const provider of providers) {
    describe(`provider: ${provider}`, () => {
      for (const fx of fixtures) {
        it(`${fx.id} [${fx.lang}]`, async () => {
          const outcome = await runFixture(provider, fx, menu);
          outcomes.push(outcome);
          writeDiffArtifact(outcome);

          if (outcome.skipped) {
            // Vitest's it.skip is dynamic-only; emulate via assertion that
            // documents the skip without failing.
            console.warn(`  [skip] ${provider}/${fx.id} — ${outcome.reason ?? "unknown"}`);
            return;
          }
          if (!outcome.ok && outcome.diff) {
            const failMsg = `\n  fixture: ${fx.id}\n  transcript: ${fx.transcript}\n${formatDiff(outcome.diff)}`;
            expect(outcome.diff.pass, failMsg).toBe(true);
          } else if (!outcome.ok) {
            expect.fail(`Provider error: ${outcome.reason ?? "unknown"}`);
          }
        }, 30_000);
      }
    });
  }

  afterAll(() => {
    const lines: string[] = ["", "── Golden parse-order summary ──"];
    for (const provider of providers) {
      const s = summarize(provider);
      lines.push(
        `  ${provider}: ${s.passed}/${s.total - s.skipped} pass (${s.skipped} skipped). p50=${s.p50}ms p95=${s.p95}ms`,
      );
    }
    console.log(lines.join("\n"));

    // Persist a machine-readable snapshot for downstream tooling / CI annotations.
    fs.mkdirSync(RUN_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(RUN_DIR, "summary.json"),
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          providers: providers.map((p) => ({ provider: p, ...summarize(p) })),
        },
        null,
        2,
      ),
    );
  });
});

// Make the file an explicit test even when the live block is skipped, so
// Vitest reports it as included in the run.
describe("golden parse-order: live runner placeholder", () => {
  it.skipIf(LIVE_ENABLED)(
    "is a no-op when GOLDEN_PARSE_ORDER_LIVE is unset (set to 1 to run real LLM)",
    () => {
      expect(true).toBe(true);
    },
  );
});
