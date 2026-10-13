/**
 * Spoken new-order alert: "New order received from customer", said aloud by
 * the device the moment an order lands. Safe to import from client components.
 *
 * How it arrives. A new storefront order sends a Web Push (lib/push.ts). The
 * service worker shows the notification and also posts `SW_PUSH_MESSAGE` to
 * every open AwaazOS page (public/sw.js — keep the message type in step).
 * `OrderVoiceAlerts` in the vendor layout hears it, speaks, and re-dispatches
 * it on `window` as `PUSH_ARRIVED_EVENT` so an open orders board refetches at
 * once. Event-driven end to end: no timer, nothing polls.
 *
 * Rules:
 *   - The phrase is fixed and carries no buyer name, amount or item: it is
 *     said out loud in a kitchen.
 *   - Speech needs a page that is open. With the phone locked or the app
 *     closed only the system notification (and its sound) plays — a service
 *     worker cannot speak.
 *   - Browsers block speech until the page has been tapped once, and iOS wants
 *     the first utterance inside a tap. `primeSpeech()` does that silently.
 *   - One per-device choice, shared with the orders board's Sound button.
 */

/** Per-device Sound choice ("on" | "off"). The key predates the voice alert. */
export const ORDER_SOUND_PREF_KEY = "awz_board_sound_v1";

export const NEW_ORDER_PHRASE = "New order received from customer";

/** `type` of the message public/sw.js posts to open pages when a push lands. */
export const SW_PUSH_MESSAGE = "awz-push";

/** Fired on `window` for each push that reached this page. `detail`: PushArrivedDetail. */
export const PUSH_ARRIVED_EVENT = "awaazos:push-arrived";

export type PushKind = "order" | "payment" | "test";

export type PushArrivedDetail = {
  kind: PushKind;
  /** The alert was already spoken (here or in another tab): don't sound again. */
  announced: boolean;
};

/** How long the winning tab holds the "I am announcing this" lock. */
const ANNOUNCE_LOCK_MS = 3_000;

// ── Pure helpers ──────────────────────────────────────────────────────────

/** Kind of push from its tag (lib/push.ts: `order-<bill>`, `pay-<bill>`, `test`). */
export function pushKindFromTag(tag: unknown): PushKind | null {
  if (typeof tag !== "string") return null;
  if (tag === "test") return "test";
  if (tag.startsWith("order-")) return "order";
  if (tag.startsWith("pay-")) return "payment";
  return null;
}

/** The tag of a service-worker push message, or null for anything else. */
export function pushMessageTag(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown; tag?: unknown };
  if (m.type !== SW_PUSH_MESSAGE || typeof m.tag !== "string") return null;
  return m.tag;
}

/** A test alert speaks too, so "Send test alert" checks the voice end to end. */
export function shouldSpeakFor(kind: PushKind): boolean {
  return kind === "order" || kind === "test";
}

// ── Browser wrappers ──────────────────────────────────────────────────────

export function readOrderSoundPref(): boolean {
  try {
    return window.localStorage.getItem(ORDER_SOUND_PREF_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeOrderSoundPref(on: boolean): void {
  try {
    window.localStorage.setItem(ORDER_SOUND_PREF_KEY, on ? "on" : "off");
  } catch {
    // Blocked storage: the choice just isn't remembered.
  }
}

export function canSpeak(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

/**
 * Say the new-order phrase. Returns false when this page cannot speak right
 * now (no speech support, or not tapped yet), so the caller can fall back to
 * its beep. A burst of orders is announced once, not queued.
 */
export function speakNewOrder(): boolean {
  if (!canSpeak()) return false;
  // Chromium/Firefox expose this; where it is missing (older Safari) just try.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
  try {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) return true;
    const utterance = new SpeechSynthesisUtterance(NEW_ORDER_PHRASE);
    utterance.lang = "en-IN";
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unlock speech from inside a tap (iOS only speaks later if the first
 * utterance was user-started). Silent.
 */
export function primeSpeech(): void {
  if (!canSpeak()) return;
  try {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) return;
    const utterance = new SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    synth.speak(utterance);
  } catch {
    // Speech is a nicety; the notification still shows.
  }
}

/**
 * With several AwaazOS tabs open every one of them hears the push. The first
 * to take the lock announces it; the rest stay quiet. Resolves true when this
 * tab should speak. No Web Locks (old browsers) → every tab may speak.
 */
export function claimAnnouncement(tag: string): Promise<boolean> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    locks
      .request(`awz-order-voice:${tag}`, { ifAvailable: true }, async (lock) => {
        resolve(lock !== null);
        if (lock) await new Promise((done) => window.setTimeout(done, ANNOUNCE_LOCK_MS));
      })
      .catch(() => resolve(true));
  });
}
