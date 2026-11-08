import { del } from "@vercel/blob";

/**
 * Shared checks for image uploads to Vercel Blob (menu item photos, store
 * banner and logo). Server-only.
 *
 * Vendors shoot these on a phone over metered mobile data, so the cap is
 * deliberately small and enforced BEFORE anything is streamed to Blob.
 * 4 MB also stays under Vercel's ~4.5 MB serverless request body limit.
 */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** A rejected upload; `message` is safe to return to the client. */
export class ImageUploadError extends Error {
  readonly status = 400;
}

/**
 * Reads the multipart `file` field and validates it — never pay for an upload
 * we reject. Throws `ImageUploadError` (400) on anything unusable.
 */
export async function readImageUpload(req: Request): Promise<{ file: Blob; ext: string }> {
  // Cheap pre-check: formData() buffers the whole body in memory, so reject
  // an oversized upload from the header before paying for that.
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > IMAGE_MAX_BYTES) {
    throw new ImageUploadError("Image must be 4MB or smaller");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ImageUploadError("Expected multipart/form-data");
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) throw new ImageUploadError("Missing file");

  const ext = ALLOWED_IMAGE_MIME[file.type];
  if (!ext) throw new ImageUploadError("Unsupported image type. Use JPEG, PNG or WebP.");
  if (file.size === 0) throw new ImageUploadError("Image is empty");
  if (file.size > IMAGE_MAX_BYTES) throw new ImageUploadError("Image must be 4MB or smaller");

  return { file, ext };
}

/**
 * Removing an old blob is housekeeping, not part of the contract: the row
 * already points somewhere valid either way, so a failure here is logged and
 * swallowed rather than failing the vendor's upload.
 */
export async function deleteBlobQuietly(url: string | null | undefined, token: string, tag: string) {
  if (!url) return;
  try {
    await del(url, { token });
  } catch (e) {
    console.error(`[${tag}] orphaned blob`, e instanceof Error ? e.message : "unknown");
  }
}
