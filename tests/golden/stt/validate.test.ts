import { describe, expect, it } from "vitest";

import {
  audioExists,
  loadSttFixtures,
  readAudioBlob,
  type SttFixture,
} from "./fixtures";
import { compareTranscripts, normalizeTranscript } from "./transcript-equality";

/**
 * Offline golden STT sanity — runs in CI, no network, no audio required.
 */

describe("golden stt: fixture integrity", () => {
  const fixtures = loadSttFixtures();

  it("loads at least 12 fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
  });

  it("has unique fixture ids", () => {
    const ids = new Set(fixtures.map((f) => f.id));
    expect(ids.size).toBe(fixtures.length);
  });

  it("fixture id prefix matches lang code", () => {
    for (const fx of fixtures) {
      const expectedPrefix = fx.lang.slice(0, 2);
      expect(fx.id.startsWith(`${expectedPrefix}-`)).toBe(true);
    }
  });

  it("covers every supported language with at least 2 fixtures", () => {
    const counts: Record<string, number> = {};
    for (const fx of fixtures) {
      counts[fx.lang] = (counts[fx.lang] ?? 0) + 1;
    }
    for (const lang of ["en-IN", "hi-IN", "te-IN", "kn-IN", "ta-IN"]) {
      expect(counts[lang] ?? 0, `lang ${lang} under-covered`).toBeGreaterThanOrEqual(2);
    }
  });

  it("expected transcripts are non-trivial after normalization", () => {
    for (const fx of fixtures) {
      expect(normalizeTranscript(fx.expectedTranscript).length).toBeGreaterThan(2);
    }
  });

  it("parseOrderFixtureId references use matching lang prefix when set", () => {
    for (const fx of fixtures) {
      if (!fx.parseOrderFixtureId) continue;
      expect(fx.parseOrderFixtureId.startsWith(fx.lang.slice(0, 2) + "-")).toBe(true);
    }
  });
});

describe("golden stt: audio clips (optional until recorded)", () => {
  const fixtures = loadSttFixtures();
  const withAudio = fixtures.filter(audioExists);
  const missing = fixtures.filter((f) => !audioExists(f));

  it("reports how many audio clips are present (informational)", () => {
    // Live STT calibration requires clips under tests/golden/stt/audio/.
    // This test never fails on missing audio — it only documents coverage.
    expect(fixtures.length).toBeGreaterThan(0);
    if (missing.length > 0) {
      console.log(
        `STT golden: ${withAudio.length}/${fixtures.length} audio clips present. ` +
          `Missing: ${missing.map((f: SttFixture) => f.audioFile).join(", ")}`,
      );
    }
  });

  it("existing audio files are non-empty", () => {
    for (const fx of withAudio) {
      const blob = readAudioBlob(fx);
      expect(blob.size).toBeGreaterThan(100);
    }
  });
});

describe("golden stt: transcript-equality unit checks", () => {
  it("treats punctuation and case differences as matches", () => {
    const diff = compareTranscripts(
      "Do Bhel, aur ek Nimbu Pani!",
      "do bhel aur ek nimbu pani",
    );
    expect(diff.pass).toBe(true);
    expect(diff.similarity).toBe(1);
  });

  it("fails when utterance diverges materially", () => {
    const diff = compareTranscripts("do bhel aur ek nimbu pani", "teen samosa", 0.85);
    expect(diff.pass).toBe(false);
  });
});
