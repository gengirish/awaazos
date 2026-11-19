import { BRAND_NAME, BRAND_WORDMARK } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The logo: the orange mic tile (the same mark as the app icons in public/)
 * and the wordmark "Awaaz" + "दो". A server-safe component with no client JS.
 *
 * The drawing is aria-hidden and a visually hidden BRAND_NAME carries the name,
 * so a screen reader says "AwaazDo" rather than switching voice for "दो".
 * Baloo 2 is loaded with its Devanagari subset (app/layout.tsx) for "दो".
 */

const SIZES = {
  sm: { tile: "h-6 w-6 rounded-md", text: "text-base", gap: "gap-1.5" },
  md: { tile: "h-8 w-8 rounded-lg", text: "text-xl", gap: "gap-2" },
  lg: { tile: "h-12 w-12 rounded-xl", text: "text-4xl", gap: "gap-3" },
} as const;

export type BrandLogoSize = keyof typeof SIZES;

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect width="32" height="32" rx="7" className="fill-brand-saffron" />
      <g fill="none" className="stroke-white" strokeWidth="2.25" strokeLinecap="round">
        <rect x="12.75" y="7" width="6.5" height="11.5" rx="3.25" />
        <path d="M9.5 14.5a6.5 6.5 0 0 0 13 0" />
        <path d="M16 21v3.5" />
      </g>
    </svg>
  );
}

export function BrandLogo({
  size = "md",
  showMark = true,
  stacked = false,
  className,
}: {
  size?: BrandLogoSize;
  /** False for the wordmark alone (tight spaces, or beside another icon). */
  showMark?: boolean;
  /** Mark above the wordmark, for narrow columns (the app rail). */
  stacked?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-center", stacked ? "flex-col gap-1" : s.gap, className)}>
      {showMark ? <BrandMark className={cn("shrink-0", s.tile)} /> : null}
      <span aria-hidden="true" className={cn("font-display font-bold leading-none tracking-tight", s.text)}>
        <span className="text-awaaz-charcoal">{BRAND_WORDMARK.latin}</span>
        <span lang="hi" className="text-awaaz-orange">
          {BRAND_WORDMARK.devanagari}
        </span>
      </span>
      <span className="sr-only">{BRAND_NAME}</span>
    </span>
  );
}
