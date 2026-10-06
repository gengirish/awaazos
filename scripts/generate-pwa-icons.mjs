#!/usr/bin/env node
/**
 * Regenerates the PWA / push icons in public/ from an inline SVG, using the
 * Playwright Chromium the repo already has for e2e (no image deps).
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * icon-192 / icon-512 / apple-touch-icon: full-bleed brand orange (#FF6600,
 *   --primary in app/globals.css) with a white mic, glyph inside the central
 *   ~50% so it survives maskable cropping and iOS corner rounding.
 * badge-72: white mic on transparent — Android renders badges as an alpha mask.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public");
mkdirSync(out, { recursive: true });

// Lucide "mic" glyph (ISC), 24×24 viewBox.
const MIC = `
  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
  <line x1="12" x2="12" y1="19" y2="22"/>`;

function svg(size, { background, glyphScale }) {
  const g = size * glyphScale;
  const offset = (size - g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}
  <svg x="${offset}" y="${offset}" width="${g}" height="${g}" viewBox="0 0 24 24" fill="none"
       stroke="#FFFFFF" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${MIC}</svg>
</svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, background: "#FF6600", glyphScale: 0.5 },
  { file: "icon-512.png", size: 512, background: "#FF6600", glyphScale: 0.5 },
  { file: "apple-touch-icon.png", size: 180, background: "#FF6600", glyphScale: 0.55 },
  { file: "badge-72.png", size: 72, background: null, glyphScale: 0.8 },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg(icon.size, icon)}</body></html>`,
    );
    await page.locator("svg").first().screenshot({ path: path.join(out, icon.file), omitBackground: true });
    console.log(`wrote public/${icon.file}`);
  }
} finally {
  await browser.close();
}
