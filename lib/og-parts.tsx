import { formatINR } from "@/lib/currency";

/**
 * Building blocks shared by the Satori-rendered images: the storefront link
 * preview (app/s/[slug]/opengraph-image.tsx) and the Instagram story image
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
