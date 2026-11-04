import type { Plan } from "@prisma/client";
import { z } from "zod";

import { releaseFalImage, reserveFalImage } from "@/lib/ai-usage-guard";
import { IMAGE_MAX_BYTES } from "@/lib/blob-image";
import { DropApiError } from "@/lib/drops-api";
import { env } from "@/lib/env";
import { aiImageRateLimit } from "@/lib/ratelimit";

/**
 * AI images from a seller's description, through fal (server-only: FAL_KEY must
 * never reach the browser). Two uses, neither stores anything here:
 *
 * - banner: POST /api/vendor/banner/generate returns a preview; "Use this
 *   banner" sends it through the normal POST /api/vendor/banner upload.
 * - story: POST on the story-image routes composites it behind the card.
 *
 * Only the seller's own words go to fal, never order or customer data, and the
 * prompt is never logged. `sync_mode` returns the image inline, so fal keeps no
 * copy in the request history and there is no third-party URL to fetch.
 *
 * Each call is billed and a retry is a new job, so nothing here retries.
 * Failures throw DropApiError with a code from lib/ai-image-types.ts.
 */
export const AI_IMAGE_MODEL = "fal-ai/flux/schnell";

export type AiImageKind = "banner" | "story";

// Banner: the 8:3 frame of the settings preview. Story: below full size on
// purpose, because the panels cover most of it and the PNG must stay under
// Vercel's response limit.
export const AI_IMAGE_SIZE: Record<AiImageKind, { width: number; height: number }> = {
  banner: { width: 1536, height: 576 },
  story: { width: 720, height: 1280 },
};

const STYLE: Record<AiImageKind, string> = {
  banner: "Wide photographic banner.",
  story: "Vertical photographic background, soft and uncluttered.",
};

const TIMEOUT_MS = 60_000;

export const aiImagePromptSchema = z.object({ prompt: z.string().trim().min(3).max(300) });

const falResponseSchema = z.object({
  images: z.array(z.object({ url: z.string() })).min(1),
  has_nsfw_concepts: z.array(z.boolean()).optional(),
});

const INLINE_IMAGE = /^data:image\/(jpeg|png);base64,/;

const fail = (status: number, error: string) => new DropApiError(status, { error });

export function aiImageRequestBody(prompt: string, kind: AiImageKind) {
  return {
    // Models garble lettering, and the real text is drawn by us.
    prompt: `${prompt}. ${STYLE[kind]} No text, letters, logos or watermarks.`,
    image_size: AI_IMAGE_SIZE[kind],
    num_images: 1,
    output_format: "jpeg",
    enable_safety_checker: true,
    sync_mode: true,
  };
}

/** Returns the image as a data URI. Call after the tenant checks: this spends money. */
export async function generateAiImage(args: {
  vendorId: string;
  plan: Plan;
  prompt: string;
  kind: AiImageKind;
}): Promise<string> {
  const { vendorId, plan, prompt, kind } = args;

  const key = env.FAL_KEY;
  if (!key) throw fail(503, "ai_images_unavailable");

  const limit = await aiImageRateLimit.check(vendorId);
  if (!limit.ok) throw fail(429, "ai_image_rate_limited");

  const usage = await reserveFalImage({ vendorId, plan });
  if (!usage.ok) {
    throw usage.code === "fal_guard_unavailable" ? fail(503, "ai_images_unavailable") : fail(402, "ai_image_cap_reached");
  }

  let res: Response;
  try {
    res = await fetch(`https://fal.run/${AI_IMAGE_MODEL}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiImageRequestBody(prompt, kind)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // The job may still have run and been billed, so the reservation stays.
    console.error("[ai-image] request failed", e instanceof Error ? e.name : "unknown");
    throw fail(502, "ai_image_failed");
  }

  if (!res.ok) {
    await releaseFalImage({ vendorId });
    // 403 is the account: out of credits, or locked. Ops needs the reason; the seller doesn't.
    if (res.status === 403) {
      const detail = await res.text().catch(() => "");
      console.error("[ai-image] account refused", detail.slice(0, 200));
      throw fail(503, "ai_images_unavailable");
    }
    console.error("[ai-image] fal error", res.status);
    throw fail(502, "ai_image_failed");
  }

  const parsed = falResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    console.error("[ai-image] unexpected response");
    throw fail(502, "ai_image_failed");
  }
  // A flagged image comes back black. It was billed, so it still counts.
  if (parsed.data.has_nsfw_concepts?.[0]) throw fail(422, "ai_image_unsafe");

  const image = parsed.data.images[0].url;
  // base64 is 4/3 of the bytes; same ceiling as an upload.
  if (!INLINE_IMAGE.test(image) || (image.length * 3) / 4 > IMAGE_MAX_BYTES) {
    console.error("[ai-image] unusable image");
    throw fail(502, "ai_image_failed");
  }
  return image;
}
