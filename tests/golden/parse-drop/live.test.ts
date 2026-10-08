import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

// lib/env validates boot secrets at import time; read keys lazily from
// process.env instead (same trick as tests/golden/parse-order/live.test.ts).
vi.mock("@/lib/env", () => ({
  requireEnv: (key: string): string => {
    const value = process.env[key];
    if (!value) throw new Error(`Required environment variable ${key} is not configured`);
    return value;
  },
  env: new Proxy({} as Record<string, string | undefined>, {
    get: (_t, key: string) => process.env[key],
  }),
}));

import {
  ANTHROPIC_FALLBACK_MODEL,
  ANTHROPIC_PRIMARY_MODEL,
  anthropicHaiku,
  anthropicSonnet,
} from "@/lib/anthropic";
import { buildDropWithClaude, parseDropFromTranscript, postProcessDropDraft } from "@/lib/parse-drop";
import type { DropDraft } from "@/lib/parse-drop-types";

import { compareDraft, loadFixtures, loadMenu, menuForParse, type DraftDiff, type DropFixture } from "./fixtures";

/**
 * Live golden voice-drop runner — real Claude calls, costs money.
 *
 *   GOLDEN_PARSE_DROP_LIVE=1 npm run test:golden:drop
 *   GOLDEN_PARSE_DROP_PROVIDER=pipeline | claude-haiku | claude-sonnet   (default: pipeline)
 *
 * "pipeline" is the route's path (Haiku → Sonnet escalation + post-processing);
 * the single-model providers skip escalation. Failures write
 * tests/golden/parse-drop/.last-run/<provider>/<id>.diff.json (gitignored).
 */

const LIVE = process.env.GOLDEN_PARSE_DROP_LIVE === "1";
const RUN_DIR = path.resolve(__dirname, ".last-run");
const PROVIDERS = ["pipeline", "claude-haiku", "claude-sonnet"] as const;
type Provider = (typeof PROVIDERS)[number];

function resolveProvider(): Provider | null {
  const p = process.env.GOLDEN_PARSE_DROP_PROVIDER ?? "pipeline";
  return (PROVIDERS as readonly string[]).includes(p) ? (p as Provider) : null;
}

async function run(provider: Provider, fx: DropFixture): Promise<DropDraft> {
  const menu = menuForParse(loadMenu());
  const now = new Date(fx.now);
  if (provider === "pipeline") {
    return (await parseDropFromTranscript({ menuItems: menu, transcript: fx.transcript, lang: fx.lang, now })).draft;
  }
  const sonnet = provider === "claude-sonnet";
  const raw = await buildDropWithClaude(
    sonnet ? anthropicSonnet : anthropicHaiku,
    sonnet ? ANTHROPIC_FALLBACK_MODEL : ANTHROPIC_PRIMARY_MODEL,
    menu,
    fx.transcript,
    fx.lang,
    now,
  );
  return postProcessDropDraft(raw, menu, now, sonnet ? "sonnet" : "haiku");
}

const results: { id: string; ok: boolean; latencyMs: number }[] = [];

describe.skipIf(!LIVE)("golden parse-drop: LIVE", () => {
  const provider = resolveProvider();
  if (!provider) {
    it("aborts on an unknown provider", () => {
      throw new Error(`Unknown GOLDEN_PARSE_DROP_PROVIDER. Known: ${PROVIDERS.join(", ")}`);
    });
    return;
  }

  for (const fx of loadFixtures()) {
    it(`${fx.id} [${fx.lang}]`, async () => {
      const t0 = Date.now();
      const draft = await run(provider, fx);
      const latencyMs = Date.now() - t0;
      const diff: DraftDiff = compareDraft(fx.expected, draft);
      results.push({ id: fx.id, ok: diff.pass, latencyMs });
      if (!diff.pass) {
        const dir = path.join(RUN_DIR, provider);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, `${fx.id}.diff.json`),
          JSON.stringify({ fixture: fx, draft, problems: diff.problems, latencyMs }, null, 2),
        );
      }
      expect(diff.pass, `\n  ${fx.id}: ${fx.transcript}\n  - ${diff.problems.join("\n  - ")}`).toBe(true);
    }, 60_000);
  }

  afterAll(() => {
    const passed = results.filter((r) => r.ok).length;
    const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
    console.log(`\n── Golden parse-drop (${provider}): ${passed}/${results.length} pass, p50=${p50}ms`);
    fs.mkdirSync(RUN_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(RUN_DIR, "summary.json"),
      JSON.stringify({ ranAt: new Date().toISOString(), provider, passed, total: results.length, results }, null, 2),
    );
  });
});

describe("golden parse-drop: live runner placeholder", () => {
  it.skipIf(LIVE)("is a no-op unless GOLDEN_PARSE_DROP_LIVE=1 (real Claude calls cost money)", () => {
    expect(true).toBe(true);
  });
});
