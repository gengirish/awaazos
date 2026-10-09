import { describe, expect, it } from "vitest";

import {
  VOICE_LANG_PREF_STORAGE_NAME,
  nextVoiceLang,
  readVoiceLangOverride,
  resolveVoiceLang,
  voiceLangCycle,
  voiceLangLabel,
  writeVoiceLangOverride,
} from "@/lib/voice-lang-pref";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("voiceLangLabel", () => {
  it("labels offered and dormant languages", () => {
    expect(voiceLangLabel("en-IN")).toBe("English");
    expect(voiceLangLabel("hi-IN")).toContain("Hindi");
    expect(voiceLangLabel("te-IN")).toContain("Telugu");
    expect(voiceLangLabel("xx-YY")).toBe("xx-YY");
  });
});

describe("voiceLangCycle", () => {
  it("is the offered languages for an offered vendor language", () => {
    expect(voiceLangCycle("en-IN")).toEqual(["en-IN", "hi-IN"]);
    expect(voiceLangCycle("hi-IN")).toEqual(["en-IN", "hi-IN"]);
  });

  it("keeps a dormant saved language in the cycle", () => {
    expect(voiceLangCycle("ta-IN")).toEqual(["en-IN", "hi-IN", "ta-IN"]);
  });

  it("ignores an unsupported saved language", () => {
    expect(voiceLangCycle("fr-FR")).toEqual(["en-IN", "hi-IN"]);
  });
});

describe("nextVoiceLang", () => {
  it("toggles between en and hi", () => {
    expect(nextVoiceLang("en-IN", "en-IN")).toBe("hi-IN");
    expect(nextVoiceLang("hi-IN", "en-IN")).toBe("en-IN");
  });

  it("cycles through a dormant saved language and wraps", () => {
    expect(nextVoiceLang("hi-IN", "kn-IN")).toBe("kn-IN");
    expect(nextVoiceLang("kn-IN", "kn-IN")).toBe("en-IN");
  });

  it("starts the cycle from an unknown current language", () => {
    expect(nextVoiceLang("fr-FR", "fr-FR")).toBe("en-IN");
  });
});

describe("resolveVoiceLang", () => {
  it("uses the vendor language without an override", () => {
    expect(resolveVoiceLang(null, "hi-IN")).toBe("hi-IN");
  });

  it("lets a valid override win", () => {
    expect(resolveVoiceLang("hi-IN", "en-IN")).toBe("hi-IN");
    expect(resolveVoiceLang("en-IN", "te-IN")).toBe("en-IN");
  });

  it("ignores a dormant override the vendor no longer has saved", () => {
    expect(resolveVoiceLang("te-IN", "en-IN")).toBe("en-IN");
  });
});

describe("readVoiceLangOverride", () => {
  it("reads a supported stored value", () => {
    expect(readVoiceLangOverride(memoryStorage({ [VOICE_LANG_PREF_STORAGE_NAME]: "hi-IN" }))).toBe("hi-IN");
  });

  it("returns null for missing, junk or unavailable storage", () => {
    expect(readVoiceLangOverride(memoryStorage())).toBeNull();
    expect(readVoiceLangOverride(memoryStorage({ [VOICE_LANG_PREF_STORAGE_NAME]: "<script>" }))).toBeNull();
    expect(readVoiceLangOverride(null)).toBeNull();
    expect(readVoiceLangOverride(throwing)).toBeNull();
  });
});

describe("writeVoiceLangOverride", () => {
  it("stores a choice that differs from the vendor language", () => {
    const s = memoryStorage();
    writeVoiceLangOverride(s, "hi-IN", "en-IN");
    expect(s.data.get(VOICE_LANG_PREF_STORAGE_NAME)).toBe("hi-IN");
  });

  it("clears the override when the vendor language is chosen", () => {
    const s = memoryStorage({ [VOICE_LANG_PREF_STORAGE_NAME]: "hi-IN" });
    writeVoiceLangOverride(s, "en-IN", "en-IN");
    expect(s.data.has(VOICE_LANG_PREF_STORAGE_NAME)).toBe(false);
  });

  it("never throws on blocked or missing storage", () => {
    expect(() => writeVoiceLangOverride(throwing, "hi-IN", "en-IN")).not.toThrow();
    expect(() => writeVoiceLangOverride(null, "hi-IN", "en-IN")).not.toThrow();
  });
});
