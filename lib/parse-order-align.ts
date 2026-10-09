import type { MenuItemForParse } from "@/lib/anthropic";

export type ParsedLine = {
  menuItemId: string;
  name: string;
  priceInPaise: number;
  qty: number;
};

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Serving / quantity words — never billable menu lines on their own. */
const CLASSIFIER_TOKENS = new Set([
  "plate",
  "plates",
  "piece",
  "pieces",
  "pc",
  "pcs",
  "cup",
  "cups",
  "glass",
  "glasses",
  "bowl",
  "bowls",
  "order",
  "bill",
  "last",
  "one",
  "two",
  "three",
  "four",
  "five",
  "do",
  "ek",
  "teen",
  "char",
  "paanch",
]);

const ENGLISH_QTY: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(row[j]! + 1, prev + 1, row[j - 1]! + cost);
      row[j - 1] = prev;
      prev = next;
    }
    row[b.length] = prev;
  }
  return row[b.length]!;
}

function parseLeadingQty(words: string[]): { qty: number; rest: string[] } {
  if (words.length === 0) return { qty: 1, rest: [] };
  const first = words[0]!;
  const asNum = Number.parseInt(first, 10);
  if (!Number.isNaN(asNum) && asNum > 0) {
    return { qty: asNum, rest: words.slice(1) };
  }
  const en = ENGLISH_QTY[first];
  if (en) return { qty: en, rest: words.slice(1) };
  return { qty: 1, rest: words };
}

/**
 * Align Claude output to the authoritative vendor menu: drop forged IDs and
 * always return canonical name + price from DB.
 */
export function alignParsedItemsToMenu(
  menuRows: MenuItemForParse[],
  items: ParsedLine[],
): ParsedLine[] {
  const byId = new Map(menuRows.map((m) => [m.id, m]));
  const aligned: ParsedLine[] = [];
  for (const item of items) {
    const menu = byId.get(item.menuItemId);
    if (!menu) continue;
    aligned.push({
      menuItemId: menu.id,
      name: menu.name,
      priceInPaise: menu.priceInPaise,
      qty: Math.max(1, Math.floor(item.qty)),
    });
  }
  return aligned;
}

type RescueCandidate = { menu: MenuItemForParse; score: number; qty: number };

/**
 * Last-resort matcher when the LLM returns no lines — handles common Web Speech
 * mishearings via phonetic-ish edit distance against menu names + aliases.
 */
export function rescueMatchFromTranscript(
  menuRows: MenuItemForParse[],
  transcript: string,
): { items: ParsedLine[]; unmatched: string[] } {
  const norm = normalizeForMatch(transcript);
  if (!norm) return { items: [], unmatched: [] };

  const words = norm.split(" ").filter(Boolean);
  const { qty, rest } = parseLeadingQty(words);
  const phrase = rest.filter((w) => !CLASSIFIER_TOKENS.has(w)).join(" ");
  if (!phrase) return { items: [], unmatched: [transcript.trim()] };

  const candidates: RescueCandidate[] = [];

  const phraseTokens = phrase.split(" ").filter(Boolean);

  for (const menu of menuRows) {
    const labels = [menu.name, ...menu.aliases].map(normalizeForMatch).filter(Boolean);
    for (const label of labels) {
      const labelTokens = label.split(" ").filter(Boolean);
      const dist = levenshtein(phrase, label);
      const maxLen = Math.max(phrase.length, label.length, 1);
      let bestScore = 1 - dist / maxLen;

      for (const pt of phraseTokens) {
        if (pt.length < 3) continue;
        for (const lt of labelTokens) {
          const td = levenshtein(pt, lt);
          const tl = Math.max(pt.length, lt.length, 1);
          bestScore = Math.max(bestScore, 1 - td / tl);
        }
        // Whole label often shorter than the misheard phrase ("less bill" → "lassi").
        if (label.length >= 3) {
          const td = levenshtein(pt, label);
          const tl = Math.max(pt.length, label.length, 1);
          bestScore = Math.max(bestScore, 1 - td / tl);
        }
      }

      if (
        bestScore >= 0.55 ||
        (phrase.length >= 4 && label.includes(phrase)) ||
        phrase.includes(label)
      ) {
        candidates.push({ menu, score: bestScore, qty });
      }
    }
  }

  if (candidates.length === 0) {
    return { items: [], unmatched: [transcript.trim()] };
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  return {
    items: [
      {
        menuItemId: best.menu.id,
        name: best.menu.name,
        priceInPaise: best.menu.priceInPaise,
        qty: best.qty,
      },
    ],
    unmatched: [],
  };
}
