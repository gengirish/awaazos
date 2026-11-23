import { afterEach, describe, expect, it, vi } from "vitest";

import { imageTypeOf, storeLogoDataUrl } from "@/lib/og-parts";

/**
 * Photos and logos for Satori (lib/og-parts.tsx): the type comes from the bytes,
 * never the Content-Type header. A PNG saved as .jpg and served as image/jpeg
 * made Satori throw mid-stream, and the share card answered 500.
 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

function served(bytes: Uint8Array<ArrayBuffer>, type: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes, { headers: { "content-type": type } })));
}

afterEach(() => vi.unstubAllGlobals());

describe("imageTypeOf", () => {
  it("tells PNG and JPEG apart by their first bytes", () => {
    expect(imageTypeOf(PNG)).toBe("image/png");
    expect(imageTypeOf(JPEG)).toBe("image/jpeg");
  });

  it("refuses WebP, empty and unknown bytes", () => {
    expect(imageTypeOf(WEBP)).toBeNull();
    expect(imageTypeOf(new Uint8Array())).toBeNull();
    expect(imageTypeOf(new TextEncoder().encode("<html>"))).toBeNull();
  });
});

describe("storeLogoDataUrl", () => {
  it("labels a PNG served as image/jpeg as PNG", async () => {
    served(PNG, "image/jpeg");
    expect(await storeLogoDataUrl("https://blob.example/photo.jpg")).toMatch(/^data:image\/png;base64,/);
  });

  it("draws a JPEG served with a generic type", async () => {
    served(JPEG, "application/octet-stream");
    expect(await storeLogoDataUrl("https://blob.example/photo")).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("drops a WebP even when it claims to be a JPEG", async () => {
    served(WEBP, "image/jpeg");
    expect(await storeLogoDataUrl("https://blob.example/photo.jpg")).toBeNull();
  });

  it("no URL → null without a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await storeLogoDataUrl(null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
