import { describe, expect, it } from "vitest";

import { STORE_BACKGROUND_TILE_PX, storeBackgroundStyle } from "@/lib/store-background";

describe("storeBackgroundStyle", () => {
  it("is nothing without a picture", () => {
    expect(storeBackgroundStyle(null)).toBeUndefined();
    expect(storeBackgroundStyle(undefined)).toBeUndefined();
    expect(storeBackgroundStyle("")).toBeUndefined();
  });

  it("repeats the tile across and down, under a wash of the page colour", () => {
    const style = storeBackgroundStyle("https://x.public.blob.vercel-storage.com/store/v_1/background-abc.png");
    expect(style).toEqual({
      backgroundImage:
        'linear-gradient(hsl(var(--background) / 0.7), hsl(var(--background) / 0.7)), url("https://x.public.blob.vercel-storage.com/store/v_1/background-abc.png")',
      backgroundRepeat: "repeat",
      backgroundSize: `auto, ${STORE_BACKGROUND_TILE_PX}px auto`,
    });
  });

  it("quotes the URL so it can't close url() early", () => {
    const style = storeBackgroundStyle('https://x/a.png"), url("https://evil/b.png');
    expect(style?.backgroundImage).toContain('url("https://x/a.png\\"), url(\\"https://evil/b.png")');
  });
});
