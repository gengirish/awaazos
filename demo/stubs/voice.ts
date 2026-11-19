import type { Page, Route } from "@playwright/test";

/**
 * Voice without any paid call (docs/DEMO_VIDEOS_PLAN.md, principle 6).
 *
 * - `fakeSpeech` replaces the browser's Web Speech recogniser: after the mic tap it
 *   "listens" for `listenMs`, then hears `transcript` as one final phrase. No audio,
 *   no STT provider. (en-IN / hi-IN go through Web Speech, so /api/ai/transcribe is
 *   never reached; `stubTranscribe` covers a store set to Kannada.)
 * - `stubParse*` answer the parse routes inside the browser (page.route), so the
 *   request never reaches the server, Anthropic, or the AI usage caps. The shapes
 *   mirror app/api/ai/parse-order, lib/parse-menu-types.ts and lib/parse-drop-types.ts;
 *   the ids are the seeded store's real ones, so saving afterwards hits the real API.
 *
 * Call before the page navigates (init scripts and routes apply to later loads).
 */

export async function fakeSpeech(page: Page, transcript: string, { listenMs = 2600 }: { listenMs?: number } = {}): Promise<void> {
  await page.addInitScript(
    ([heard, wait]: readonly [string, number]) => {
      class FakeRecognition {
        lang = "";
        continuous = false;
        interimResults = false;
        maxAlternatives = 1;
        onresult: ((ev: unknown) => void) | null = null;
        onerror: ((ev: unknown) => void) | null = null;
        onend: ((ev: unknown) => void) | null = null;
        private ended = false;
        start() {
          setTimeout(() => {
            if (this.ended) return;
            const phrase = Object.assign([{ transcript: heard, confidence: 0.92 }], { isFinal: true });
            this.onresult?.({ results: [phrase], resultIndex: 0 });
            setTimeout(() => this.finish(), 100);
          }, wait);
        }
        stop() {
          this.finish();
        }
        abort() {
          this.onerror?.({ error: "aborted" });
          this.finish();
        }
        private finish() {
          if (this.ended) return;
          this.ended = true;
          this.onend?.(new Event("end"));
        }
      }
      const w = window as unknown as Record<string, unknown>;
      w.SpeechRecognition = FakeRecognition;
      w.webkitSpeechRecognition = FakeRecognition;
    },
    [transcript, listenMs] as const,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Answer `pattern` in the browser after `thinkMs` (so "Understanding…" is on screen a moment). */
async function answer(page: Page, pattern: string, body: unknown, thinkMs: number): Promise<void> {
  await page.route(pattern, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await sleep(thinkMs);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

export type ParsedLine = { menuItemId: string; name: string; priceInPaise: number; qty: number };

/** POST /api/ai/parse-order → the counter cart. */
export async function stubParseOrder(page: Page, items: ParsedLine[], { thinkMs = 900 }: { thinkMs?: number } = {}): Promise<void> {
  await answer(page, "**/api/ai/parse-order", { items, unmatched: [], confidence: "high", modelUsed: "haiku" }, thinkMs);
}

/** POST /api/ai/parse-menu → `{ data: MenuDraft }` (lib/parse-menu-types.ts). */
export async function stubParseMenu(page: Page, draft: unknown, { thinkMs = 1100 }: { thinkMs?: number } = {}): Promise<void> {
  await answer(page, "**/api/ai/parse-menu", { data: draft }, thinkMs);
}

/** POST /api/ai/parse-drop → `{ data: DropDraft }` (lib/parse-drop-types.ts). */
export async function stubParseDrop(page: Page, draft: unknown, { thinkMs = 1100 }: { thinkMs?: number } = {}): Promise<void> {
  await answer(page, "**/api/ai/parse-drop", { data: draft }, thinkMs);
}

/** POST /api/ai/transcribe, for a store whose voice language records audio (Kannada). */
export async function stubTranscribe(page: Page, transcript: string, { thinkMs = 700 }: { thinkMs?: number } = {}): Promise<void> {
  await answer(page, "**/api/ai/transcribe", { transcript, durationMs: 2400, sttSource: "sarvam" }, thinkMs);
}

/** A new dish in a parse-menu draft. `rupees` 0 = no price heard (the form asks for one). */
export function newDish(name: string, rupees: number, category: string, emoji: string) {
  return {
    key: `new:${name.toLowerCase()}`,
    name,
    priceInPaise: rupees * 100,
    category,
    emoji,
    aliases: [],
    action: "create" as const,
    existingMenuItemId: null,
    existingPriceInPaise: null,
    priceSpoken: rupees > 0,
  };
}

/** An existing dish whose price the seller just said differently. */
export function priceUpdate(
  item: { id: string; name: string; rupees: number; category: string; emoji: string },
  newRupees: number,
) {
  return {
    key: `existing:${item.id}`,
    name: item.name,
    priceInPaise: newRupees * 100,
    category: item.category,
    emoji: item.emoji,
    aliases: [],
    action: "update_price" as const,
    existingMenuItemId: item.id,
    existingPriceInPaise: item.rupees * 100,
    priceSpoken: true,
  };
}

/** IST calendar day `offset` days from now, as YYYY-MM-DD. */
export function istYmd(offset: number): string {
  return new Date(Date.now() + 5.5 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}
