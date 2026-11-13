import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: vi.fn(() => "sarvam_test_key"),
  env: {} as Record<string, unknown>,
}));

import { transcribeAudio } from "@/lib/sarvam";

const ORIGINAL_FETCH = globalThis.fetch;
const SAMPLE_BLOB = new Blob([new Uint8Array([0, 1, 2, 3])], { type: "audio/webm" });

function captureBody(): { body: () => FormData } {
  let sent: FormData | null = null;
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent = init?.body as FormData;
    return new Response(JSON.stringify({ transcript: "eradu masala dosa", language_probability: 0.97 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { body: () => sent! };
}

describe("sarvam.transcribeAudio", () => {
  beforeEach(() => {
    delete process.env.SARVAM_STT_MODEL;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.SARVAM_STT_MODEL;
    vi.restoreAllMocks();
  });

  it("asks saaras:v3 for romanised output in the vendor's language", async () => {
    const sent = captureBody();
    const result = await transcribeAudio(SAMPLE_BLOB, "kn-IN");

    expect(result).toEqual({ transcript: "eradu masala dosa", confidence: 0.97 });
    expect(sent.body().get("model")).toBe("saaras:v3");
    expect(sent.body().get("language_code")).toBe("kn-IN");
    expect(sent.body().get("mode")).toBe("translit");
  });

  it("sends no mode to a model that does not take one", async () => {
    process.env.SARVAM_STT_MODEL = "saaras:v4";
    const sent = captureBody();
    await transcribeAudio(SAMPLE_BLOB, "kn-IN");

    expect(sent.body().get("model")).toBe("saaras:v4");
    expect(sent.body().get("mode")).toBeNull();
  });
});
