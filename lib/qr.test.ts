import { describe, expect, it } from "vitest";

import { qrPngDataUrl, qrSvgDataUrl } from "./qr";

describe("qrSvgDataUrl", () => {
  it("renders an SVG data URL locally, without embedding a remote URL", async () => {
    const url = await qrSvgDataUrl("upi://pay?pa=x@okaxis&pn=y&am=1.00&cu=INR", 220);
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="220"');
    // Only the SVG namespace URI; no image is fetched from anywhere.
    expect(svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")).not.toContain("http");
  });
});

describe("qrPngDataUrl", () => {
  it("renders a PNG data URL of the requested width, for saving to a gallery", async () => {
    const url = await qrPngDataUrl("upi://pay?pa=x@okaxis&pn=y&am=1.00&cu=INR", 512);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const png = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    // PNG signature, then IHDR width (bytes 16-19, big-endian).
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(512);
  });
});
