/**
 * Shrink a photo in the browser before upload. Phone cameras produce 5–12 MB
 * files; the server caps uploads at 4 MB (lib/blob-image.ts) and vendors are
 * on metered mobile data. Client-safe: no server imports.
 */

export type DownscaleOptions = {
  maxWidth: number;
  maxHeight: number;
  /** Output type. JPEG for photos; PNG keeps a logo's transparency. */
  type: "image/jpeg" | "image/png";
  /** JPEG quality, 0–1. Ignored for PNG. */
  quality?: number;
};

/** Largest size that fits the box without upscaling, aspect ratio kept. */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/**
 * Returns a smaller copy of `file`, or `file` itself when it already fits, the
 * browser can't decode it, or the result would be larger. Best-effort: the
 * server re-validates whatever arrives.
 */
export async function downscaleImage(file: File, opts: DownscaleOptions): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, opts.maxWidth, opts.maxHeight);
    const unchanged = size.width === bitmap.width && size.height === bitmap.height;
    if (unchanged && file.type === opts.type) return file;

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, opts.type, opts.quality));
    if (!blob || (unchanged && blob.size >= file.size)) return file;

    const ext = opts.type === "image/png" ? "png" : "jpg";
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${base}.${ext}`, { type: opts.type });
  } finally {
    bitmap.close();
  }
}
