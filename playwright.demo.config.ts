import { defineConfig, devices } from "@playwright/test";

/**
 * Demo videos (docs/DEMO_VIDEOS_PLAN.md). Not part of `npm run e2e`: scenes live in
 * demo/scenes and match *.demo.ts, which the main config's testDir never reaches.
 *
 * Same safety rule as the E2E suite: the global setup refuses production and any
 * non-local database, because every scene registers a store and places orders.
 *
 * Always record against a production build (`npm run build && npx next start -p 3100`)
 * with BASE_URL set: `next dev` shows its indicator and stalls on first compiles.
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3100";

/**
 * Pixel ratio of the recording. Chrome's screencast paints at the browser's own
 * scale, not the emulated one, so the scale is also forced at launch
 * (--force-device-scale-factor); without it frames come back at 360 × 640.
 *
 * Measured on a constantly scrolling page (2026-11-15, new headless): 3× gives
 * 1080 × 1920 at ~14 fps, 2.5× gives 900 × 1600 at ~27 fps, 2× 720 × 1280 at ~37 fps.
 * 2.5× is the default: smooth pans, and render.mjs scales it to 1080 × 1920.
 * DEMO_SCALE=3 suits a scene that mostly holds still.
 */
const SCALE = Number(process.env.DEMO_SCALE ?? "2.5");

/** 360 × 640 CSS px: a 9:16 phone, the Reels / Status frame. */
const PHONE_9_16 = {
  ...devices["Pixel 7"],
  viewport: { width: 360, height: 640 },
  screen: { width: 360, height: 640 },
  deviceScaleFactor: SCALE,
  // The new headless mode screencasts ~35% faster than the headless shell at the same scale.
  channel: "chromium",
  launchOptions: { args: [`--force-device-scale-factor=${SCALE}`] },
};

export default defineConfig({
  testDir: "./demo/scenes",
  testMatch: "**/*.demo.ts",
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "demo-output/test-results",
  // A scene is a film, not a test run: one at a time, never retried, generous time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    // The kit records through CDP screencast (demo/kit/recorder.ts); Playwright's own
    // video is a low-bitrate file at CSS-pixel size. Set DEMO_PW_VIDEO=1 to compare.
    video: process.env.DEMO_PW_VIDEO === "1" ? { mode: "on", size: { width: 1080, height: 1920 } } : "off",
  },
  projects: [{ name: "phone", use: PHONE_9_16 }],
});
