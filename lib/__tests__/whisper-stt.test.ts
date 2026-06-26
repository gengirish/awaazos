import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SAMPLE_BLOB = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], {
  type: "audio/webm",
});

const ORIGINAL_FETCH = globalThis.fetch;

describe("whisper-stt.transcribeAudio", () => {
  beforeEach(() => {
    process.env.WHISPER_STT_URL = "https://whisper.test.internal";
    process.env.WHISPER_STT_SECRET = "test-secret-min-16-chars";
  });

  afterEach(() => {
    delete process.env.WHISPER_STT_URL;
    delete process.env.WHISPER_STT_SECRET;
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("whisperSttConfigured returns false when URL or secret missing", async () => {
    delete process.env.WHISPER_STT_URL;
    const { whisperSttConfigured } = await import("@/lib/whisper-stt");
    expect(whisperSttConfigured()).toBe(false);
  });

  it("whisperSttConfigured returns true when URL and secret are set", async () => {
    const { whisperSttConfigured } = await import("@/lib/whisper-stt");
    expect(whisperSttConfigured()).toBe(true);
  });

  it("posts multipart audio to /v1/transcribe with bearer auth", async () => {
    let calledUrl = "";
    let calledHeaders: Headers | null = null;
    let calledBody: unknown = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = typeof input === "string" ? input : input.toString();
      calledHeaders = new Headers(init?.headers);
      calledBody = init?.body;
      return new Response(JSON.stringify({ text: "do bhel aur ek nimbu pani", confidence: 0.9 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { transcribeAudio } = await import("@/lib/whisper-stt");
    const result = await transcribeAudio(SAMPLE_BLOB, "hi-IN");

    expect(result.transcript).toBe("do bhel aur ek nimbu pani");
    expect(result.confidence).toBe(0.9);
    expect(calledUrl).toBe("https://whisper.test.internal/v1/transcribe");
    expect(calledHeaders!.get("authorization")).toBe(
      "Bearer test-secret-min-16-chars",
    );
    const fd = calledBody as FormData;
    expect(fd.get("language")).toBe("hi");
    expect(fd.get("file")).toBeInstanceOf(Blob);
  });

  it("maps every supported language to ISO-639-1", async () => {
    const cases: Array<["en-IN" | "hi-IN" | "te-IN" | "kn-IN" | "ta-IN", string]> = [
      ["en-IN", "en"],
      ["hi-IN", "hi"],
      ["te-IN", "te"],
      ["kn-IN", "kn"],
      ["ta-IN", "ta"],
    ];

    for (const [lang, expected] of cases) {
      let sentLang: FormDataEntryValue | null = null;
      globalThis.fetch = vi.fn(async (_input, init?: RequestInit) => {
        sentLang = (init?.body as FormData).get("language");
        return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
      }) as unknown as typeof fetch;

      const { transcribeAudio } = await import("@/lib/whisper-stt");
      await transcribeAudio(SAMPLE_BLOB, lang);
      expect(sentLang).toBe(expected);
      vi.resetModules();
    }
  });

  it("throws on non-2xx with a snippet of the upstream error", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const { transcribeAudio } = await import("@/lib/whisper-stt");
    await expect(transcribeAudio(SAMPLE_BLOB, "hi-IN")).rejects.toThrow(
      /Whisper STT HTTP 401/,
    );
  });

  it("aborts on the 8-second hard timeout", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_input, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    const { transcribeAudio } = await import("@/lib/whisper-stt");
    const promise = transcribeAudio(SAMPLE_BLOB, "hi-IN");
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    vi.useRealTimers();
  });
});
