import type { CSSProperties } from "react";

/**
 * The store page's background pattern (`Vendor.backgroundUrl`, set in
 * Settings → Online store). Pure, client-safe.
 *
 * The picture is one tile, repeated across and down the page behind the items
 * (a peacock feather, a block print, a kolam). A busy tile behind headings and
 * prices is hard to read, so a wash of the page colour sits over it: the
 * pattern reads as a texture, and item cards stay solid on top of it.
 */
export const STORE_BACKGROUND_TILE_PX = 200;
/** Opacity of the page-colour wash over the tile (0 = tile at full strength). */
export const STORE_BACKGROUND_WASH = 0.7;

export function storeBackgroundStyle(url: string | null | undefined): CSSProperties | undefined {
  if (!url) return undefined;
  const wash = `hsl(var(--background) / ${STORE_BACKGROUND_WASH})`;
  return {
    // JSON.stringify quotes the URL, so nothing in it can end the url() early.
    backgroundImage: `linear-gradient(${wash}, ${wash}), url(${JSON.stringify(url)})`,
    backgroundRepeat: "repeat",
    backgroundSize: `auto, ${STORE_BACKGROUND_TILE_PX}px auto`,
  };
}
