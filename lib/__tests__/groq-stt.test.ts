import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: vi.fn(() => "gsk_test_key_1234567890"),
  env: {} as Record<string, unknown>,
}));

import { transcribeAudio } from "@/lib/groq-stt";

const ORIGINAL_FETCH = globalThis.fetch;
const SAMPLE_BLOB = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], {
  type: "audio/webm",
});

function mockFetchOnce(init: {
  body: unknown;
  status?: number;
}): typeof fetch {
  return vi.fn(async () => {
    const status = init.status ?? 200;
    const body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("groq-stt.transcribeAudio", () => {
  beforeEach(() => {
    delete process.env.GROQ_STT_MODEL;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("hits the Groq OpenAI-compatible endpoint with bearer auth + multipart body", async () => {
    let calledUrl = "";
    let calledHeaders: Headers | null = null;
    let calledBody: unknown = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = typeof input === "string" ? input : input.toString();
      calledHeaders = new Headers(init?.headers);
      calledBody = init?.body;
      return new Response(JSON.stringify({ text: "do bhel aur ek nimbu pani" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await transcribeAudio(SAMPLE_BLOB, "hi-IN");

    expect(result.transcript).toBe("do bhel aur ek nimbu pani");
    expect(typeof result.confidence).toBe("number");
    expect(calledUrl).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(calledHeaders!.get("authorization")).toMatch(/^Bearer gsk_/);
    expect(calledBody).toBeInstanceOf(FormData);

    const fd = calledBody as FormData;
    expect(fd.get("model")).toBe("whisper-large-v3-turbo");
    expect(fd.get("language")).toBe("hi");
    expect(fd.get("response_format")).toBe("json");
    expect(fd.get("temperature")).toBe("0");
    expect(fd.get("file")).toBeInstanceOf(Blob);
  });

  it("maps every supported language to its ISO-639-1 base code", async () => {
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

      await transcribeAudio(SAMPLE_BLOB, lang);
      expect(sentLang).toBe(expected);
    }
  });

  it("respects GROQ_STT_MODEL env override (so we can swap model without redeploying)", async () => {
    process.env.GROQ_STT_MODEL = "whisper-large-v3";
    let sentModel: FormDataEntryValue | null = null;
    globalThis.fetch = vi.fn(async (_input, init?: RequestInit) => {
      sentModel = (init?.body as FormData).get("model");
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;

    await transcribeAudio(SAMPLE_BLOB, "te-IN");

    expect(sentModel).toBe("whisper-large-v3");
  });

  it("returns the default confidence (0.85) when the response has no segments", async () => {
    globalThis.fetch = mockFetchOnce({ body: { text: "hello" } });
    const result = await transcribeAudio(SAMPLE_BLOB, "en-IN");
    expect(result.confidence).toBe(0.85);
  });

  it("derives confidence from segment.avg_logprob when present", async () => {
    globalThis.fetch = mockFetchOnce({
      body: {
        text: "ek bhel",
        segments: [
          { avg_logprob: Math.log(0.9) },
          { avg_logprob: Math.log(0.8) },
        ],
      },
    });

    const result = await transcribeAudio(SAMPLE_BLOB, "hi-IN");

    expect(result.confidence).toBeCloseTo((0.9 + 0.8) / 2, 5);
  });

  it("clamps confidence into [0, 1] when upstream returns malformed avg_logprob", async () => {
    globalThis.fetch = mockFetchOnce({
      body: {
        text: "weird",
        segments: [{ avg_logprob: 100 }, { avg_logprob: -Infinity }],
      },
    });

    const result = await transcribeAudio(SAMPLE_BLOB, "en-IN");

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("throws on non-2xx with a snippet of the upstream error (no full body leak)", async () => {
    globalThis.fetch = mockFetchOnce({
      body: "x".repeat(2000),
      status: 401,
    });

    await expect(transcribeAudio(SAMPLE_BLOB, "hi-IN")).rejects.toThrow(/Groq STT HTTP 401/);
  });

  it("returns empty transcript when upstream returns no text field", async () => {
    globalThis.fetch = mockFetchOnce({ body: { unrelated: 1 } });

    const result = await transcribeAudio(SAMPLE_BLOB, "hi-IN");

    expect(result.transcript).toBe("");
  });

  it("aborts on the 5-second hard timeout", async () => {
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

    const promise = transcribeAudio(SAMPLE_BLOB, "hi-IN");
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    vi.useRealTimers();
  });
});
