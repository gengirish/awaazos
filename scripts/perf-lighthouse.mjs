#!/usr/bin/env node
/**
 * Mobile Lighthouse runs against a running production build — local / manual
 * only, not part of CI (lab numbers on a shared runner are too noisy to gate
 * on; CI gates on bundle size instead, see scripts/check-bundle-budget.mjs).
 *
 *   npm run build && npx next start -p 3102          # throwaway Postgres, see CLAUDE.md
 *   BASE_URL=http://localhost:3102 PERF_PATHS=/,/sign-in,/s/<slug> npm run perf:lighthouse
 *
 * Signed-in pages need the Auth.js session cookie of a test vendor:
 *   PERF_AUTH_PATHS=/orders,/pos,/menu,/transactions PERF_COOKIE="authjs.session-token=…"
 *
 * Each page is run PERF_RUNS times (default 3) with Lighthouse's default mobile
 * emulation and simulated slow-4G throttling; the table shows the median.
 * Never point this at production: signed-in pages read Postgres on every run.
 *
 * Lighthouse itself is fetched by npx (not a dependency). Chrome comes from
 * CHROME_PATH, else the Chromium that Playwright installed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RUNS = Math.max(1, Number(process.env.PERF_RUNS ?? 3));
const list = (v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const publicPaths = list(process.env.PERF_PATHS ?? "/,/sign-in");
const authPaths = list(process.env.PERF_AUTH_PATHS);
const cookie = process.env.PERF_COOKIE ?? "";
const outDir = process.env.PERF_OUT_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "awz-lighthouse-"));

if (authPaths.length > 0 && !cookie) {
  console.error("PERF_AUTH_PATHS needs PERF_COOKIE (the test vendor's session cookie).");
  process.exit(2);
}

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const { chromium } = await import("@playwright/test");
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

function runOnce(url, file, headersFile, chrome) {
  const args = [
    "--yes",
    "lighthouse@12",
    url,
    "--quiet",
    "--only-categories=performance",
    "--output=json",
    `--output-path=${file}`,
    '--chrome-flags="--headless=new --no-sandbox --disable-gpu"',
  ];
  if (headersFile) args.push(`--extra-headers=${headersFile}`);
  spawnSync("npx", args, {
    stdio: ["ignore", "ignore", "inherit"],
    shell: true,
    env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) },
  });
  // On Windows Lighthouse can exit non-zero while cleaning its temp profile
  // after the report is already written — trust the file, not the exit code.
  if (!fs.existsSync(file)) return null;
  const lhr = JSON.parse(fs.readFileSync(file, "utf8"));
  if (lhr.runtimeError) {
    console.error(`  ${url}: ${lhr.runtimeError.code}`);
    return null;
  }
  const requests = lhr.audits["network-requests"]?.details?.items ?? [];
  const jsBytes = requests
    .filter((r) => r.resourceType === "Script")
    .reduce((n, r) => n + (r.transferSize ?? 0), 0);
  const totalBytes = requests.reduce((n, r) => n + (r.transferSize ?? 0), 0);
  return {
    perf: Math.round((lhr.categories.performance.score ?? 0) * 100),
    fcp: lhr.audits["first-contentful-paint"].numericValue,
    lcp: lhr.audits["largest-contentful-paint"].numericValue,
    tbt: lhr.audits["total-blocking-time"].numericValue,
    cls: lhr.audits["cumulative-layout-shift"].numericValue,
    jsKb: jsBytes / 1024,
    totalKb: totalBytes / 1024,
    requests: requests.length,
    finalUrl: lhr.finalDisplayedUrl,
  };
}

const chrome = await chromePath();
let headersFile = null;
if (cookie) {
  headersFile = path.join(outDir, "headers.json");
  fs.writeFileSync(headersFile, JSON.stringify({ Cookie: cookie }));
}

const rows = [];
for (const [paths, hdr] of [
  [publicPaths, null],
  [authPaths, headersFile],
]) {
  for (const p of paths) {
    const url = BASE_URL + p;
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const file = path.join(outDir, `${p.replace(/[^a-z0-9]+/gi, "_") || "root"}-${i + 1}.json`);
      // Chrome occasionally loses the trace (NO_NAVSTART); one retry keeps the median honest.
      const r = runOnce(url, file, hdr, chrome) ?? runOnce(url, file, hdr, chrome);
      if (r) runs.push(r);
    }
    if (runs.length === 0) {
      rows.push({ path: p, error: "no successful run" });
      continue;
    }
    if (new URL(runs[0].finalUrl).pathname !== p) {
      console.error(`  ${p} ended on ${runs[0].finalUrl} — redirected (signed out?)`);
    }
    const m = (k) => median(runs.map((r) => r[k]));
    rows.push({
      path: p,
      runs: runs.length,
      perf: m("perf"),
      perfAll: runs.map((r) => r.perf).join("/"),
      fcpMs: Math.round(m("fcp")),
      lcpMs: Math.round(m("lcp")),
      tbtMs: Math.round(m("tbt")),
      cls: Number(m("cls").toFixed(3)),
      jsKb: Math.round(m("jsKb")),
      totalKb: Math.round(m("totalKb")),
      requests: m("requests"),
    });
  }
}

fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(rows, null, 2));
console.table(rows);
console.log(`Median of ${RUNS} run(s) per page. Reports: ${outDir}`);
