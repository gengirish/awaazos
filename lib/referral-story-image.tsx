import { STORY_SAFE } from "@/lib/drop-story-image";
import { OG_COLORS as C, truncate } from "@/lib/og-parts";
import { REFERRED_TRIAL_DAYS } from "@/lib/referral";
import { BRAND_NAME } from "@/lib/brand";

/**
 * Instagram story image for Settings → Refer a seller (1080×1920 PNG),
 * rendered by GET /api/vendor/referrals/story-image. Same frame, safe zones
 * (STORY_SAFE keeps text clear of Instagram's top and bottom overlays) and
 * font rules as the drop and store stories (lib/drop-story-image.tsx).
 *
 * Takes only the store name and the printed link — never contact details.
 */
export function ReferralStoryCard({ storeName, linkLabel }: { storeName: string; linkLabel: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: C.surface,
        borderTop: `24px solid ${C.primary}`,
        padding: `${STORY_SAFE.top}px ${STORY_SAFE.side}px ${STORY_SAFE.bottom}px`,
        color: C.ink,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 44, color: C.primary, fontWeight: 700 }}>From a fellow seller</div>
        <div style={{ display: "flex", fontSize: 92, fontWeight: 700, lineHeight: 1.1, marginTop: 16 }}>
          {truncate(storeName, 40)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1.15 }}>
          {`Start your own store on ${BRAND_NAME}`}
        </div>
        <div style={{ display: "flex", fontSize: 44, color: C.muted, marginTop: 28, lineHeight: 1.3 }}>
          Take orders and UPI payments from one link, not DMs.
        </div>
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            fontSize: 72,
            fontWeight: 700,
            color: C.primary,
            background: C.tint,
            borderRadius: 24,
            padding: "20px 36px",
            marginTop: 48,
          }}
        >
          {`${REFERRED_TRIAL_DAYS} days free`}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>Tap the link to sign up</div>
        <div style={{ display: "flex", fontSize: 36, color: C.ink, marginTop: 24 }}>{truncate(linkLabel, 46)}</div>
      </div>
    </div>
  );
}
