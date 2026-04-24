/**
 * Map a Web Speech API `SpeechRecognitionErrorEvent.error` code to the
 * internal `errorReason` strings rendered by `VoiceOrderButton`.
 *
 * Spec: https://wicg.github.io/speech-api/#enumdef-speechrecognitionerrorcode
 *
 * Pure & runtime-agnostic so it can be unit-tested without a DOM.
 */

export type VoiceErrorReason =
  | "stt_unsupported"
  | "webspeech_error"
  | "parse_failed"
  | "mic_denied"
  | "unsupported_lang"
  | "use_webspeech"
  | "transcribe_failed"
  | "stt_degraded"
  | "empty_transcript"
  | "network_error"
  | "lang_not_supported_stt"
  | "no_speech_detected"
  | "voice_aborted";

export function mapWebSpeechErrorCode(code: string | null | undefined): VoiceErrorReason {
  switch ((code ?? "").toLowerCase()) {
    case "not-allowed":
    case "permission-denied":
    case "service-not-allowed":
      return "mic_denied";
    case "audio-capture":
      return "mic_denied";
    case "network":
      return "network_error";
    case "no-speech":
      return "no_speech_detected";
    case "aborted":
      return "voice_aborted";
    case "language-not-supported":
      return "lang_not_supported_stt";
    case "bad-grammar":
    default:
      return "webspeech_error";
  }
}
