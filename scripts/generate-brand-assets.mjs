#!/usr/bin/env node
/**
 * Regenerates the browser-tab favicon and the site's link-preview image, using
 * the Playwright Chromium the repo already has for e2e (no image deps).
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * app/favicon.ico        16, 32 and 48 px PNGs in one ICO: the BrandMark tile
 *                        (components/brand/BrandLogo.tsx), orange with a white mic.
 * app/opengraph-image.png 1200×630 card: mark, "Awaaz" + "दो" wordmark, tagline.
 *                        What WhatsApp / Instagram show for an awaazdo.store link.
 *                        Store pages keep their own (app/s/[slug]/opengraph-image.tsx).
 *
 * Both are static files Next serves as metadata, so nothing renders per request.
 * The card is drawn here rather than in Satori because Satori has no Devanagari
 * font for "दो"; this script loads Baloo 2 from Google Fonts at generation time.
 *
 * Name and tagline are read from lib/brand.ts, so re-run this after a rename.
 * App icons (public/icon-*.png) come from scripts/generate-pwa-icons.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "app");

const brandSource = readFileSync(path.join(root, "lib/brand.ts"), "utf8");
function brandConst(pattern, label) {
  const m = brandSource.match(pattern);
  if (!m) throw new Error(`lib/brand.ts: couldn't read ${label}`);
  return m[1];
}
const TAGLINE = brandConst(/BRAND_TAGLINE = "([^"]+)"/, "BRAND_TAGLINE");
const LATIN = brandConst(/latin: "([^"]+)"/, "BRAND_WORDMARK.latin");
const DEVANAGARI = brandConst(/devanagari: "([^"]+)"/, "BRAND_WORDMARK.devanagari");

// Colours as in app/globals.css: --color-brand-saffron, --awaaz-orange, --awaaz-charcoal.
const SAFFRON = "#FF6B00";
const ORANGE = "#BD4F00";
const CHARCOAL = "#212121";
const CREAM = "#FBF6F1";

// BrandMark from components/brand/BrandLogo.tsx, 32×32 viewBox.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
  <rect width="32" height="32" rx="7" fill="${SAFFRON}"/>
  <g fill="none" stroke="#FFFFFF" stroke-width="2.25" stroke-linecap="round">
    <rect x="12.75" y="7" width="6.5" height="11.5" rx="3.25"/>
    <path d="M9.5 14.5a6.5 6.5 0 0 0 13 0"/>
    <path d="M16 21v3.5"/>
  </g>
</svg>`;

/** ICO container holding PNG images (supported by every current browser). */
function packIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const OG_HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700&family=Nunito:wght@500;700&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; }
  .card { width: 1200px; height: 630px; box-sizing: border-box; padding: 0 96px; background: ${CREAM};
    display: flex; flex-direction: column; justify-content: center; position: relative; overflow: hidden; }
  .card::after { content: ""; position: absolute; right: -140px; top: -140px; width: 460px; height: 460px;
    border-radius: 50%; background: ${SAFFRON}; opacity: 0.08; }
  .logo { display: flex; align-items: center; gap: 36px; }
  .mark { width: 168px; height: 168px; flex: none; }
  .word { font-family: "Baloo 2", sans-serif; font-weight: 700; font-size: 176px; line-height: 1;
    letter-spacing: -2px; color: ${CHARCOAL}; padding-top: 18px; }
  .word span { color: ${ORANGE}; }
  .tagline { font-family: "Baloo 2", sans-serif; font-weight: 700; font-size: 60px; color: ${ORANGE};
    margin-top: 28px; }
  .line { font-family: "Nunito", sans-serif; font-weight: 500; font-size: 36px; color: #3F3F46;
    margin-top: 12px; max-width: 1008px; line-height: 1.3; }
  .host { position: absolute; left: 96px; bottom: 48px; font-family: "Nunito", sans-serif; font-weight: 700;
    font-size: 30px; color: ${CHARCOAL}; }
</style></head><body>
<div class="card">
  <div class="logo"><div class="mark">${MARK}</div><div class="word">${LATIN}<span lang="hi">${DEVANAGARI}</span></div></div>
  <div class="tagline">${TAGLINE}</div>
  <div class="line">Orders and UPI billing for Instagram and WhatsApp sellers</div>
  <div class="host">awaazdo.store</div>
</div></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();

  const pngs = [];
  for (const size of [16, 32, 48]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${MARK}</div></body></html>`,
    );
    const data = await page.locator("div").first().screenshot({ omitBackground: true });
    pngs.push({ size, data });
  }
  writeFileSync(path.join(appDir, "favicon.ico"), packIco(pngs));
  console.log("wrote app/favicon.ico (16, 32, 48)");

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(OG_HTML, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const fontsOk = await page.evaluate(
    () => document.fonts.check('700 60px "Baloo 2"', "दो") && document.fonts.check('500 36px "Nunito"'),
  );
  if (!fontsOk) throw new Error("Baloo 2 / Nunito didn't load from Google Fonts; check the network and re-run");
  await page.locator(".card").screenshot({ path: path.join(appDir, "opengraph-image.png") });
  console.log("wrote app/opengraph-image.png (1200×630)");
} finally {
  await browser.close();
}
