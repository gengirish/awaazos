/**
 * Strict cart equality for golden tests.
 *
 * Two carts are equal when:
 *   - Same set of menuItemId values (order doesn't matter)
 *   - Same qty per menuItemId (must match exactly — billing)
 *   - Same set of unmatched strings (whitespace + case-normalized)
 *   - Actual confidence rank >= minConfidence rank in the fixture
 *
 * The diff structure is intentionally machine-readable so the live test runner
 * can dump it to disk for post-run inspection.
 */

import type { ParseOrderResult } from "@/lib/anthropic";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ExpectedItem {
  menuItemId: string;
  qty: number;
}

export interface ExpectedCart {
  items: ExpectedItem[];
  unmatched: string[];
  minConfidence: ConfidenceLevel;
}

export interface CartDiff {
  pass: boolean;
  missing: ExpectedItem[];
  extra: Array<{ menuItemId: string; qty: number }>;
  qtyMismatches: Array<{ menuItemId: string; expected: number; actual: number }>;
  unmatchedDelta: { missing: string[]; extra: string[] };
  confidenceOk: boolean;
  actualConfidence: ConfidenceLevel;
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function normalizeUnmatched(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Consolidate items by menuItemId — if the LLM returned two entries for the
 * same id, sum their qtys before comparing. The route doesn't currently do
 * this, but defensively normalizing here means the fixtures stay simple.
 */
function consolidate(
  items: Array<{ menuItemId: string; qty: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) {
    out.set(it.menuItemId, (out.get(it.menuItemId) ?? 0) + it.qty);
  }
  return out;
}

export function compareCarts(
  expected: ExpectedCart,
  actual: ParseOrderResult,
): CartDiff {
  const exp = consolidate(expected.items);
  const act = consolidate(actual.items);

  const missing: ExpectedItem[] = [];
  const qtyMismatches: CartDiff["qtyMismatches"] = [];
  exp.forEach((expQty, id) => {
    const actQty = act.get(id);
    if (actQty == null) {
      missing.push({ menuItemId: id, qty: expQty });
    } else if (actQty !== expQty) {
      qtyMismatches.push({ menuItemId: id, expected: expQty, actual: actQty });
    }
  });

  const extra: CartDiff["extra"] = [];
  act.forEach((actQty, id) => {
    if (!exp.has(id)) extra.push({ menuItemId: id, qty: actQty });
  });

  const expUnmatched = new Set(expected.unmatched.map(normalizeUnmatched));
  const actUnmatched = new Set(actual.unmatched.map(normalizeUnmatched));
  const missingUnmatched = Array.from(expUnmatched).filter((s) => !actUnmatched.has(s));
  const extraUnmatched = Array.from(actUnmatched).filter((s) => !expUnmatched.has(s));

  const confidenceOk =
    CONFIDENCE_RANK[actual.confidence] >= CONFIDENCE_RANK[expected.minConfidence];

  const pass =
    missing.length === 0 &&
    extra.length === 0 &&
    qtyMismatches.length === 0 &&
    missingUnmatched.length === 0 &&
    extraUnmatched.length === 0 &&
    confidenceOk;

  return {
    pass,
    missing,
    extra,
    qtyMismatches,
    unmatchedDelta: { missing: missingUnmatched, extra: extraUnmatched },
    confidenceOk,
    actualConfidence: actual.confidence,
  };
}

/** Render a diff in a human-readable way for test failure messages. */
export function formatDiff(diff: CartDiff): string {
  if (diff.pass) return "(carts match)";
  const lines: string[] = [];
  if (diff.missing.length > 0) {
    lines.push(
      `  missing items: ${diff.missing
        .map((i) => `${i.menuItemId}×${i.qty}`)
        .join(", ")}`,
    );
  }
  if (diff.extra.length > 0) {
    lines.push(
      `  extra items: ${diff.extra
        .map((i) => `${i.menuItemId}×${i.qty}`)
        .join(", ")}`,
    );
  }
  if (diff.qtyMismatches.length > 0) {
    lines.push(
      `  qty mismatches: ${diff.qtyMismatches
        .map((q) => `${q.menuItemId} expected ${q.expected} got ${q.actual}`)
        .join(", ")}`,
    );
  }
  if (diff.unmatchedDelta.missing.length > 0) {
    lines.push(
      `  expected unmatched not present: ${diff.unmatchedDelta.missing.join(", ")}`,
    );
  }
  if (diff.unmatchedDelta.extra.length > 0) {
    lines.push(
      `  unexpected unmatched: ${diff.unmatchedDelta.extra.join(", ")}`,
    );
  }
  if (!diff.confidenceOk) {
    lines.push(`  confidence below threshold: got ${diff.actualConfidence}`);
  }
  return lines.join("\n");
}
