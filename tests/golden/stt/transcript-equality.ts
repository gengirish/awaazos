/**
 * Transcript comparison for golden STT tests.
 *
 * STT output varies slightly run-to-run (punctuation, spacing, transliteration).
 * We normalize then compare with a similarity threshold so a new backend can
 * be calibrated against a reference without requiring byte-identical output.
 */

export interface TranscriptDiff {
  pass: boolean;
  expectedNormalized: string;
  actualNormalized: string;
  similarity: number;
  minSimilarity: number;
}

/** Collapse whitespace, lowercase, strip common punctuation. */
export function normalizeTranscript(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:'"()\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance — O(m*n), fine for short POS utterances. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, row[j]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

/** Similarity in [0, 1] — 1.0 is identical after normalization. */
export function transcriptSimilarity(expected: string, actual: string): number {
  const a = normalizeTranscript(expected);
  const b = normalizeTranscript(actual);
  if (a === b) return 1;
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return Math.max(0, 1 - dist / maxLen);
}

export function compareTranscripts(
  expected: string,
  actual: string,
  minSimilarity = 0.85,
): TranscriptDiff {
  const expectedNormalized = normalizeTranscript(expected);
  const actualNormalized = normalizeTranscript(actual);
  const similarity = transcriptSimilarity(expected, actual);
  return {
    pass: similarity >= minSimilarity,
    expectedNormalized,
    actualNormalized,
    similarity,
    minSimilarity,
  };
}

export function formatTranscriptDiff(diff: TranscriptDiff): string {
  if (diff.pass) return "(transcripts match)";
  return [
    `  similarity ${(diff.similarity * 100).toFixed(1)}% < ${(diff.minSimilarity * 100).toFixed(0)}% threshold`,
    `  expected: "${diff.expectedNormalized}"`,
    `  actual:   "${diff.actualNormalized}"`,
  ].join("\n");
}
