/**
 * AI images (lib/ai-image.ts). fal, env, the limiter and the usage guard are
 * mocked: no network and nothing billed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  key: "test-key" as string | undefined,
  limitOk: true,
  reserve: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    get FAL_KEY() {
      return h.key;
    },
  },
}));
vi.mock("@/lib/ratelimit", () => ({ aiImageRateLimit: { check: async () => ({ ok: h.limitOk }) } }));
vi.mock("@/lib/ai-usage-guard", () => ({ reserveFalImage: h.reserve, releaseFalImage: h.release }));
vi.mock("@/lib/rbac", () => ({ AuthError: class extends Error {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { AI_IMAGE_SIZE, aiImagePromptSchema, generateAiImage } from "@/lib/ai-image";

const IMAGE = "data:image/jpeg;base64,/9j/AAAA";
const fetchMock = vi.fn();
const args = { vendorId: "v1", plan: "STARTER", prompt: "a wooden table", kind: "banner" } as const;

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

async function failure(): Promise<{ status: number; body: { error: string } }> {
  try {
    await generateAiImage(args);
  } catch (e) {
    return e as { status: number; body: { error: string } };
  }
  throw new Error("expected a failure");
}

beforeEach(() => {
  h.key = "test-key";
  h.limitOk = true;
  h.reserve.mockReset().mockResolvedValue({ ok: true });
  h.release.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("generateAiImage", () => {
  it("sends the schema's fields with the key in a header and returns the inline image", async () => {
    fetchMock.mockResolvedValue(ok({ images: [{ url: IMAGE }], has_nsfw_concepts: [false] }));
    expect(await generateAiImage(args)).toBe(IMAGE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://fal.run/fal-ai/flux/schnell");
    expect(init.headers.Authorization).toBe("Key test-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      image_size: AI_IMAGE_SIZE.banner,
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
      sync_mode: true,
    });
    expect(body.prompt).toContain("a wooden table");
    expect(body.prompt).toContain("No text");
  });

  it("spends nothing without a key, over the rate limit or over the cap", async () => {
    h.key = undefined;
    expect(await failure()).toMatchObject({ status: 503, body: { error: "ai_images_unavailable" } });

    h.key = "test-key";
    h.limitOk = false;
    expect(await failure()).toMatchObject({ status: 429, body: { error: "ai_image_rate_limited" } });

    h.limitOk = true;
    h.reserve.mockResolvedValue({ ok: false, code: "vendor_fal_image_cap_reached", message: "" });
    expect(await failure()).toMatchObject({ status: 402, body: { error: "ai_image_cap_reached" } });

    h.reserve.mockResolvedValue({ ok: false, code: "fal_guard_unavailable", message: "" });
    expect(await failure()).toMatchObject({ status: 503, body: { error: "ai_images_unavailable" } });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives the reservation back when fal refuses, and does not retry", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await failure()).toMatchObject({ status: 502, body: { error: "ai_image_failed" } });
    expect(h.release).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("treats a 403 as the account, not the seller", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "Exhausted balance" }), { status: 403 }));
    expect(await failure()).toMatchObject({ status: 503, body: { error: "ai_images_unavailable" } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps the reservation when the request may have been billed", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect(await failure()).toMatchObject({ status: 502, body: { error: "ai_image_failed" } });
    expect(h.release).not.toHaveBeenCalled();
  });

  it("rejects a flagged image and anything that isn't inline", async () => {
    fetchMock.mockResolvedValueOnce(ok({ images: [{ url: IMAGE }], has_nsfw_concepts: [true] }));
    expect(await failure()).toMatchObject({ status: 422, body: { error: "ai_image_unsafe" } });

    fetchMock.mockResolvedValueOnce(ok({ images: [{ url: "https://evil.example/x.jpg" }] }));
    expect(await failure()).toMatchObject({ status: 502, body: { error: "ai_image_failed" } });

    fetchMock.mockResolvedValueOnce(ok({ images: [] }));
    expect(await failure()).toMatchObject({ status: 502, body: { error: "ai_image_failed" } });
  });

  it("never logs the prompt", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await failure();
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain("wooden table");
  });
});

describe("aiImagePromptSchema", () => {
  it("trims and bounds the prompt", () => {
    expect(aiImagePromptSchema.parse({ prompt: "  a table  " }).prompt).toBe("a table");
    expect(aiImagePromptSchema.safeParse({ prompt: " a " }).success).toBe(false);
    expect(aiImagePromptSchema.safeParse({ prompt: "x".repeat(301) }).success).toBe(false);
  });
});
