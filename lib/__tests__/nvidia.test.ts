import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: vi.fn(() => "nvapi-test-key-1234567890"),
  env: {} as Record<string, unknown>,
}));

import { transcribeAudio } from "@/lib/nvidia";

const ORIGINAL_FETCH = globalThis.fetch;
const SAMPLE_BLOB = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], {
  type: "audio/webm",
});

function mockFetchOnce(
  init: { body: unknown; status?: number; headers?: Record<string, string> },
): typeof fetch {
  return vi.fn(async () => {
    const status = init.status ?? 200;
    const body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    return new Response(body, {
      status,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
}

describe("nvidia.transcribeAudio", () => {
  beforeEach(() => {
    delete process.env.NVIDIA_PARAKEET_FUNCTION_ID;
    delete process.env.NVIDIA_PARAKEET_INFERENCE_PATH;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("hits the NVCF invocation endpoint with bearer auth + multipart body", async () => {
    let calledUrl = "";
    let calledHeaders: Headers | null = null;
    let calledBody: unknown = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = typeof input === "string" ? input : input.toString();
      calledHeaders = new Headers(init?.headers);
      calledBody = init?.body;
      return new Response(JSON.stringify({ text: "ek bhel aur do nimbu pani" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await transcribeAudio(SAMPLE_BLOB, "hi-IN");

    expect(result.transcript).toBe("ek bhel aur do nimbu pani");
    expect(typeof result.confidence).toBe("number");
    expect(calledUrl).toContain(".invocation.api.nvcf.nvidia.com");
    expect(calledUrl).toMatch(/\/v1\/audio\/transcriptions$/);
    expect(calledHeaders!.get("authorization")).toMatch(/^Bearer nvapi-/);
    expect(calledBody).toBeInstanceOf(FormData);
    const fd = calledBody as FormData;
    expect(fd.get("language")).toBe("hi-IN");
    expect(fd.get("file")).toBeInstanceOf(Blob);
  });

  it("maps en-IN to en-US (Parakeet multilingual has no en-IN code)", async () => {
    let sentLang: FormDataEntryValue | null = null;
    globalThis.fetch = vi.fn(async (_input, init?: RequestInit) => {
      sentLang = (init?.body as FormData).get("language");
      return new Response(JSON.stringify({ text: "two bhels" }), { status: 200 });
    }) as unknown as typeof fetch;

    await transcribeAudio(SAMPLE_BLOB, "en-IN");

    expect(sentLang).toBe("en-US");
  });

  it("respects NVIDIA_PARAKEET_FUNCTION_ID override (so we can swap models without redeploying)", async () => {
    process.env.NVIDIA_PARAKEET_FUNCTION_ID = "00000000-aaaa-bbbb-cccc-111111111111";
    let calledUrl = "";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;

    await transcribeAudio(SAMPLE_BLOB, "hi-IN");

    expect(calledUrl).toContain("00000000-aaaa-bbbb-cccc-111111111111");
  });

  it("throws on non-2xx with a snippet of the upstream error (no full body leak)", async () => {
    globalThis.fetch = mockFetchOnce({
      body: "RIVA_INTERNAL: too long error message ".repeat(20),
      status: 503,
    });

    await expect(transcribeAudio(SAMPLE_BLOB, "hi-IN")).rejects.toThrow(/NVIDIA ASR HTTP 503/);
  });

  it("falls back to .transcript when .text is missing", async () => {
    globalThis.fetch = mockFetchOnce({
      body: { transcript: "moodu samosa", confidence: 0.91 },
    });

    const result = await transcribeAudio(SAMPLE_BLOB, "hi-IN");

    expect(result.transcript).toBe("moodu samosa");
    expect(result.confidence).toBeCloseTo(0.91);
  });

  it("falls back to joined .segments[].text when neither .text nor .transcript is present", async () => {
    globalThis.fetch = mockFetchOnce({
      body: { segments: [{ text: "ek " }, { text: "vada pav" }] },
    });

    const result = await transcribeAudio(SAMPLE_BLOB, "hi-IN");

    expect(result.transcript).toBe("ek  vada pav");
  });

  it("returns empty transcript when upstream returns no recognizable field", async () => {
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
