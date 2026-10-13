/**
 * Spoken new-order alert: "New order received from Priya", said aloud by the
 * device the moment an order lands. Safe to import from client components.
 *
 * How it arrives. A new storefront order sends a Web Push (lib/push.ts). The
 * service worker shows the notification and also posts `SW_PUSH_MESSAGE` to
 * every open AwaazOS page (public/sw.js — keep the message type in step).
 * `OrderVoiceAlerts` in the vendor layout hears it, speaks, and re-dispatches
 * it on `window` as `PUSH_ARRIVED_EVENT` so an open orders board refetches at
 * once. Event-driven end to end: no timer, nothing polls.
 *
 * Rules:
 *   - The buyer's first name is spoken, nothing else about them. It never
 *     rides in the push (lock screens are public, and push services see the
 *     payload): the page asks GET /api/storefront-orders/announce for it by
 *     bill number, as signed-in staff. No name in time → "customer".
 *   - A name is only handed to a voice that runs on the device
 *     (`localService`). Some desktop browsers offer voices that send the text
 *     to a server; with only those, the alert says "customer".
 *   - Speech needs a page that is open. With the phone locked or the app
 *     closed only the system notification (and its sound) plays — a service
 *     worker cannot speak.
 *   - Browsers block speech until the page has been tapped once, and iOS wants
 *     the first utterance inside a tap. `primeSpeech()` does that silently.
 *   - One per-device choice, shared with the orders board's Sound button.
 *     On until the vendor turns it off.
 */

/** Per-device Sound choice ("on" | "off"; unset = on). The key predates the voice alert. */
export const ORDER_SOUND_PREF_KEY = "awz_board_sound_v1";

export const NEW_ORDER_PHRASE = "New order received from customer";

/** Longest name the alert will say; a longer one is cut, not skipped. */
const SPOKEN_NAME_MAX = 30;
/** The alert never waits longer than this for the name. */
const NAME_FETCH_TIMEOUT_MS = 2_500;

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

/** Bill number of a new-order push (`order-<bill>`), or null. */
export function billFromOrderTag(tag: string): string | null {
  if (!tag.startsWith("order-")) return null;
  return tag.slice("order-".length) || null;
}

/**
 * The part of a buyer's name the alert says: the first word, letters only
 * (buyers type this themselves, so no digits, symbols or sentences), or null.
 */
export function spokenName(raw: string | null | undefined): string | null {
  const first = raw?.trim().split(/\s+/)[0] ?? "";
  const clean = first.replace(/[^\p{L}\p{M}'.-]/gu, "").slice(0, SPOKEN_NAME_MAX);
  return /\p{L}/u.test(clean) ? clean : null;
}

export function newOrderPhrase(name?: string | null): string {
  const said = spokenName(name);
  return said ? `New order received from ${said}` : NEW_ORDER_PHRASE;
}

/** A test alert speaks too, so "Send test alert" checks the voice end to end. */
export function shouldSpeakFor(kind: PushKind): boolean {
  return kind === "order" || kind === "test";
}

// ── Browser wrappers ──────────────────────────────────────────────────────

export function readOrderSoundPref(): boolean {
  try {
    return window.localStorage.getItem(ORDER_SOUND_PREF_KEY) !== "off";
  } catch {
    return true;
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
 * The buyer's first name for a new-order push, asked of our own server as the
 * signed-in staff member. null on any miss, error or timeout: the alert then
 * says "customer" instead of waiting.
 */
export async function fetchOrderFirstName(bill: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/storefront-orders/announce?bill=${encodeURIComponent(bill)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(NAME_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { firstName?: unknown } };
    return typeof body.data?.firstName === "string" ? body.data.firstName : null;
  } catch {
    return null;
  }
}

/**
 * An on-device voice, Indian English first. `none` = this browser only has
 * voices that send the text away; `unknown` = it has not listed its voices
 * (phones often don't; they speak through the system engine).
 */
function localVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | "none" | "unknown" {
  const voices = synth.getVoices?.() ?? [];
  if (voices.length === 0) return "unknown";
  const local = voices.filter((v) => v.localService);
  if (local.length === 0) return "none";
  return (
    local.find((v) => v.lang.replace("_", "-") === "en-IN") ??
    local.find((v) => v.lang.startsWith("en")) ??
    local.find((v) => v.default) ??
    local[0]!
  );
}

/**
 * Say the new-order alert, with the buyer's first name when one is given.
 * Returns false when this page cannot speak right now (no speech support, or
 * not tapped yet), so the caller can fall back to its beep. A burst of orders
 * is announced once, not queued.
 */
export function speakNewOrder(name?: string | null): boolean {
  if (!canSpeak()) return false;
  // Chromium/Firefox expose this; where it is missing (older Safari) just try.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
  try {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) return true;
    const voice = localVoice(synth);
    // No on-device voice: the name stays here, the alert still speaks.
    const utterance = new SpeechSynthesisUtterance(voice === "none" ? NEW_ORDER_PHRASE : newOrderPhrase(name));
    utterance.lang = "en-IN";
    if (typeof voice === "object") utterance.voice = voice;
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
