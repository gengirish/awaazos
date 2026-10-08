import { describe, expect, it } from "vitest";

import { qrSvgDataUrl } from "./qr";

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
