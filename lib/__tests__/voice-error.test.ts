import { describe, expect, it } from "vitest";

import { mapWebSpeechErrorCode } from "@/lib/voice-error";

describe("mapWebSpeechErrorCode", () => {
  it("maps permission codes to mic_denied", () => {
    expect(mapWebSpeechErrorCode("not-allowed")).toBe("mic_denied");
    expect(mapWebSpeechErrorCode("permission-denied")).toBe("mic_denied");
    expect(mapWebSpeechErrorCode("service-not-allowed")).toBe("mic_denied");
    expect(mapWebSpeechErrorCode("audio-capture")).toBe("mic_denied");
  });

  it("maps offline / proxy issues to network_error", () => {
    expect(mapWebSpeechErrorCode("network")).toBe("network_error");
  });

  it("maps silence to no_speech_detected", () => {
    expect(mapWebSpeechErrorCode("no-speech")).toBe("no_speech_detected");
  });

  it("maps user/system aborts to voice_aborted", () => {
    expect(mapWebSpeechErrorCode("aborted")).toBe("voice_aborted");
  });

  it("maps locale rejection to lang_not_supported_stt", () => {
    expect(mapWebSpeechErrorCode("language-not-supported")).toBe("lang_not_supported_stt");
  });

  it("falls back to webspeech_error for unknown / nullish input", () => {
    expect(mapWebSpeechErrorCode(undefined)).toBe("webspeech_error");
    expect(mapWebSpeechErrorCode(null)).toBe("webspeech_error");
    expect(mapWebSpeechErrorCode("")).toBe("webspeech_error");
    expect(mapWebSpeechErrorCode("bad-grammar")).toBe("webspeech_error");
    expect(mapWebSpeechErrorCode("totally-made-up")).toBe("webspeech_error");
  });

  it("is case-insensitive on the input code", () => {
    expect(mapWebSpeechErrorCode("NOT-ALLOWED")).toBe("mic_denied");
    expect(mapWebSpeechErrorCode("Network")).toBe("network_error");
  });
});
