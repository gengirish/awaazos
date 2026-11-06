import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";

import { storeLogoDataUrl } from "@/lib/og-parts";
import { isStoreAppIconSize, storeInitial, storeThemeHex } from "@/lib/store-app";
import { loadStoreApp } from "@/lib/store-app-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The store's Home Screen icon (lib/store-app.ts): its logo on its colour, or
 * the first letter of its name when there is no logo Satori can draw (none,
 * WebP, too slow). 180 px is the iPhone `apple-touch-icon`; 192 and 512 are the
 * manifest's. Same gate as the store page, so a miss is 404.
 *
 * The logo fills the centre 56%: inside the circle Android cuts a maskable
 * icon to, and a framed badge where the icon is shown whole. An installed app
 * keeps the icon it was installed with until the browser next updates it, so
 * this can be cached.
 */

/** ShoppingBag from lucide (24×24): stands in for a first letter the bundled font can't draw. */
function BagGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 10a4 4 0 0 1-8 0" />
      <path d="M3.103 6.034h17.794" />
      <path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" />
    </svg>
  );
}

export async function GET(_req: Request, props: { params: Promise<{ slug: string; size: string }> }) {
  const { slug, size: rawSize } = await props.params;
  const size = Number(rawSize);
  if (!Number.isInteger(size) || !isStoreAppIconSize(size)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const store = await loadStoreApp(slug);
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const background = storeThemeHex(store.settings?.theme);
  const logo = await storeLogoDataUrl(store.logoUrl);
  const inner = Math.round(size * 0.56);
  const initial = storeInitial(store.name);
  // The default font is Latin only; anything else would make Satori fetch a font.
  const drawLetter = /^[A-Z0-9]$/.test(initial);

  const image = new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background,
        }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image.
          <img
            src={logo}
            alt=""
            width={inner}
            height={inner}
            style={{ objectFit: "cover", borderRadius: Math.round(inner * 0.18) }}
          />
        ) : drawLetter ? (
          <span style={{ color: "#FFFFFF", fontSize: Math.round(size * 0.5), fontWeight: 700, lineHeight: 1 }}>
            {initial}
          </span>
        ) : (
          <BagGlyph size={Math.round(size * 0.46)} />
        )}
      </div>
    ),
    { width: size, height: size },
  );
  image.headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400");
  return image;
}
