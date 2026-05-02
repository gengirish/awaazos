import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: vi.fn(() => "sk-test-key-1234567890"),
  env: {} as Record<string, unknown>,
}));

import { transcribeAudio } from "@/lib/openai-stt";

const ORIGINAL_FETCH = globalThis.fetch;
const SAMPLE_BLOB = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], {
  type: "audio/webm",
});

function mockFetchOnce(init: {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}): typeof fetch {
  return vi.fn(async () => {
    const status = init.status ?? 200;
    const body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    return new Response(body, {
      status,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
}

describe("openai-stt.transcribeAudio", () => {
  beforeEach(() => {
    delete process.env.OPENAI_STT_MODEL;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("hits the official OpenAI audio/transcriptions endpoint with bearer auth + multipart body", async () => {
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
    expect(calledUrl).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(calledHeaders!.get("authorization")).toMatch(/^Bearer sk-/);
    expect(calledBody).toBeInstanceOf(FormData);

    const fd = calledBody as FormData;
    expect(fd.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(fd.get("language")).toBe("hi");
    expect(fd.get("response_format")).toBe("json");
    expect(fd.getAll("include[]")).toContain("logprobs");
    expect(fd.get("file")).toBeInstanceOf(Blob);
  });

  it("maps en-IN to en (region tag stripped — Whisper accepts ISO-639-1 base codes)", async () => {
    let sentLang: FormDataEntryValue | null = null;
    globalThis.fetch = vi.fn(async (_input, init?: RequestInit) => {
      sentLang = (init?.body as FormData).get("language");
      return new Response(JSON.stringify({ text: "two bhels and one lemonade" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await transcribeAudio(SAMPLE_BLOB, "en-IN");

    expect(sentLang).toBe("en");
  });

  it("respects OPENAI_STT_MODEL env override (so we can swap model without redeploying)", async () => {
    process.env.OPENAI_STT_MODEL = "gpt-4o-transcribe";
    let sentModel: FormDataEntryValue | null = null;
    globalThis.fetch = vi.fn(async (_input, init?: RequestInit) => {
      sentModel = (init?.body as FormData).get("model");
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;

    await transcribeAudio(SAMPLE_BLOB, "hi-IN");

    expect(sentModel).toBe("gpt-4o-transcribe");
  });

  it("derives confidence from logprobs (mean exp of token logprobs)", async () => {
    globalThis.fetch = mockFetchOnce({
      body: {
        text: "ek bhel",
        logprobs: [
          { token: "ek", logprob: Math.log(0.9) },
          { token: " bhel", logprob: Math.log(0.8) },
        ],
      },
    });

    const result = await transcribeAudio(SAMPLE_BLOB, "hi-IN");

    expect(result.transcript).toBe("ek bhel");
    expect(result.confidence).toBeCloseTo((0.9 + 0.8) / 2, 5);
  });

  it("falls back to a default confidence when logprobs are absent or empty", async () => {
    globalThis.fetch = mockFetchOnce({ body: { text: "hello" } });
    let result = await transcribeAudio(SAMPLE_BLOB, "en-IN");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);

    globalThis.fetch = mockFetchOnce({ body: { text: "hello", logprobs: [] } });
    result = await transcribeAudio(SAMPLE_BLOB, "en-IN");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("clamps confidence into [0, 1] when upstream returns malformed logprobs", async () => {
    globalThis.fetch = mockFetchOnce({
      body: {
        text: "weird",
        logprobs: [
          { token: "w", logprob: 100 }, // Math.exp(100) is huge — must clamp
          { token: "e", logprob: -Infinity },
        ],
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

    await expect(transcribeAudio(SAMPLE_BLOB, "hi-IN")).rejects.toThrow(/OpenAI STT HTTP 401/);
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
