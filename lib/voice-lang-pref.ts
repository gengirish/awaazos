/**
 * Device-local voice language override for the POS mic.
 *
 * The vendor's saved `VendorSettings.voiceLang` is the default. A cashier can
 * tap the language badge to switch this device between the offered languages
 * (`VOICE_LANGUAGES`); that choice lives in localStorage and wins over the
 * saved value. A dormant saved language (te/kn/ta) stays in the cycle so the
 * cashier can always get back to it.
 *
 * Pure apart from the storage helpers, which take the storage as an argument
 * and swallow every error (private mode, blocked site data, SSR).
 */
import { SUPPORTED_VOICE_LANGS, VOICE_LANGUAGES } from "@/lib/constants";

export const VOICE_LANG_PREF_STORAGE_NAME = "awz_voice_lang_v1";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem" | "removeItem">;

const SUPPORTED = new Set<string>(SUPPORTED_VOICE_LANGS);

const DORMANT_LABELS: Record<string, string> = {
  "te-IN": "తెలుగు (Telugu)",
  "kn-IN": "ಕನ್ನಡ (Kannada)",
  "ta-IN": "தமிழ் (Tamil)",
};

/** Human label for a voice language code; falls back to the code itself. */
export function voiceLangLabel(lang: string): string {
  const known = VOICE_LANGUAGES.find((l) => l.value === lang);
  if (known) return known.label;
  return DORMANT_LABELS[lang] ?? lang;
}

/**
 * The languages the badge cycles through: the offered ones, plus the vendor's
 * saved language when it is a supported-but-dormant one.
 */
export function voiceLangCycle(vendorLang: string): string[] {
  const cycle: string[] = VOICE_LANGUAGES.map((l) => l.value);
  if (SUPPORTED.has(vendorLang) && !cycle.includes(vendorLang)) cycle.push(vendorLang);
  return cycle;
}

/** The language after `current` in the cycle (wraps; unknown → first). */
export function nextVoiceLang(current: string, vendorLang: string): string {
  const cycle = voiceLangCycle(vendorLang);
  const idx = cycle.indexOf(current);
  return cycle[(idx + 1) % cycle.length]!;
}

/**
 * The language the mic should use. A stored override wins when it is still
 * part of the cycle; anything else (stale, tampered, missing) is ignored.
 */
export function resolveVoiceLang(override: string | null, vendorLang: string): string {
  if (override && voiceLangCycle(vendorLang).includes(override)) return override;
  return vendorLang;
}

export function readVoiceLangOverride(storage: ReadableStorage | null | undefined): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(VOICE_LANG_PREF_STORAGE_NAME);
    return raw && SUPPORTED.has(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Stores the cashier's choice. Choosing the vendor's own saved language clears
 * the override, so a later change in Settings takes effect on this device.
 */
export function writeVoiceLangOverride(
  storage: WritableStorage | null | undefined,
  lang: string,
  vendorLang: string,
): void {
  if (!storage) return;
  try {
    if (lang === vendorLang) storage.removeItem(VOICE_LANG_PREF_STORAGE_NAME);
    else storage.setItem(VOICE_LANG_PREF_STORAGE_NAME, lang);
  } catch {
    // Blocked storage: the choice just isn't remembered.
  }
}

/** `window.localStorage`, or null where it is unavailable or throws. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
