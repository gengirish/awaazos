import { formatINR } from "@/lib/currency";

/**
 * Building blocks shared by the Satori-rendered images: the storefront link
 * preview (app/s/[slug]/share-card/store-card.tsx) and the Instagram story image
 * (lib/drop-story-image.tsx, lib/store-story-image.tsx).
 *
 * Satori only supports inline styles, so colours are literal here — CSS
 * variables don't exist. The default bundled font has no ₹ glyph and would
 * trigger a Google Fonts fetch, so the rupee sign is drawn as an inline SVG.
 */

export const OG_COLORS = {
  primary: "#FF6B00",
  ink: "#1A1A1A",
  muted: "#475569",
  surface: "#FFFFFF",
  tint: "#FFF4EC",
  rule: "#E2E8F0",
};

export function RupeeGlyph({ size: px }: { size: number }) {
  return (
    <svg width={px * 0.62} height={px} viewBox="0 0 20 32" style={{ marginRight: px * 0.06 }}>
      <path
        d="M3 5 H18 M3 12 H18 M3 5 H8 C13 5 15 8 15 11.5 C15 15 12 18 8 18 H4 L15 29"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** formatINR output with the ₹ drawn as SVG. */
export function Price({ paise, fontSize }: { paise: number; fontSize: number }) {
  const digits = formatINR(paise).replace("₹", "").trim();
  return (
    <div style={{ display: "flex", alignItems: "center", fontSize }}>
      <RupeeGlyph size={fontSize * 0.8} />
      <span>{digits}</span>
    </div>
  );
}

export function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function fulfilmentModeLabel(mode: string): string {
  return mode === "PICKUP" ? "Pickup" : mode === "BOTH" ? "Delivery or pickup" : "Delivery";
}

const LOGO_MAX_BYTES = 1_500_000;

/**
 * PNG or JPEG from the file's first bytes, else null. Never from the
 * Content-Type header: some stored photos are PNG bytes saved as `.jpg` and
 * served as image/jpeg, and Satori, told "jpeg", throws mid-stream while
 * reading PNG bytes, so the card answered 500 with no image.
 */
export function imageTypeOf(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/**
 * The store logo as a data URL for Satori, or null. A slow or missing blob
 * degrades to "no logo" rather than a broken image or a 500 half-way through
 * the render. PNG / JPEG only (Satori can't draw WebP), told apart by the bytes
 * (`imageTypeOf`). Used by the link
 * preview, the store's app icon (app/s/[slug]/app-icon/[size]) and a product link's
 * preview, which draws the item's photo with it (app/s/[slug]/p/[itemId]).
 */
export async function storeLogoDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) return null;
    const type = imageTypeOf(bytes);
    if (!type) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
