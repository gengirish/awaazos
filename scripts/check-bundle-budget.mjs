#!/usr/bin/env node
/**
 * Bundle-size budget: fails when the JavaScript a phone must download to open
 * a page grows past `perf-budget.json`. Reads the production build that
 * `npm run build` already wrote to `.next/` — no server, no browser, no network,
 * so it is deterministic enough to gate CI on (Lighthouse is not; see
 * scripts/perf-lighthouse.mjs for manual lab runs).
 *
 *   npm run build && npm run perf:budget          # check
 *   npm run perf:budget -- --update               # re-record budgets (+headroom)
 *   npm run perf:budget -- --json                 # machine-readable sizes
 *
 * What is measured, per route: gzip size (level 9, like Next's build table) of
 * every JS file the route's first load needs — the shared runtime, each layout
 * above the page, and the page itself. Next's own "First Load JS" column leaves
 * the layouts' chunks out, so these numbers run a little higher and are the
 * truer cost. Lazy chunks (`next/dynamic`, `import()`) are not counted: they
 * are not needed for first paint. kB = 1000 bytes, as in the build table.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const distDir = path.join(root, process.env.NEXT_DIST_DIR ?? ".next");
const budgetPath = path.join(root, "perf-budget.json");
const args = new Set(process.argv.slice(2));
const UPDATE = args.has("--update");
const JSON_OUT = args.has("--json");

function readJson(file, why) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    console.error(`bundle budget: cannot read ${path.relative(root, file)} — ${why}`);
    process.exit(2);
  }
}

const buildManifest = readJson(path.join(distDir, "build-manifest.json"), "run `npm run build` first.");
const appManifest = readJson(
  path.join(distDir, "app-build-manifest.json"),
  "run `npm run build` first (webpack build; this file is how routes map to chunks).",
);

const sizeCache = new Map();
function gzipBytes(file) {
  let n = sizeCache.get(file);
  if (n === undefined) {
    n = zlib.gzipSync(fs.readFileSync(path.join(distDir, file)), { level: 9 }).length;
    sizeCache.set(file, n);
  }
  return n;
}
const isJs = (f) => f.endsWith(".js");
const total = (files) => [...files].filter(isJs).reduce((n, f) => n + gzipBytes(f), 0);
const kb = (bytes) => Math.round(bytes / 100) / 10;

/** "/(vendor)/orders/page" → "/orders"; "/(marketing)/page" → "/". */
function routeOf(key) {
  const segs = key.split("/").slice(1, -1).filter((s) => !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

const entries = appManifest.pages ?? {};
const shared = new Set(buildManifest.rootMainFiles ?? []);
const sharedBytes = total(shared);

/** route → gzip bytes of everything its first load needs. */
const routes = new Map();
for (const key of Object.keys(entries)) {
  if (!key.endsWith("/page")) continue; // route handlers ship no client JS
  const files = new Set(shared);
  const dirs = key.split("/").slice(0, -1); // ["", "(vendor)", "orders"]
  for (let i = 1; i <= dirs.length; i++) {
    const layoutKey = `${dirs.slice(0, i).join("/")}/layout`;
    for (const f of entries[layoutKey] ?? []) files.add(f);
  }
  for (const f of entries[key]) files.add(f);
  routes.set(routeOf(key), total(files));
}

if (routes.size === 0) {
  console.error("bundle budget: no app routes found in app-build-manifest.json.");
  process.exit(2);
}

const measured = {
  sharedKb: kb(sharedBytes),
  routesKb: Object.fromEntries([...routes.entries()].sort().map(([r, b]) => [r, kb(b)])),
};

if (JSON_OUT) {
  console.log(JSON.stringify(measured, null, 2));
  process.exit(0);
}

const DEFAULT_HEADROOM = 8;
const existing = fs.existsSync(budgetPath) ? readJson(budgetPath, "invalid JSON.") : null;

if (UPDATE) {
  const headroom = existing?.headroomPercent ?? DEFAULT_HEADROOM;
  const withRoom = (n) => Math.ceil(n * (1 + headroom / 100));
  // Keep the same set of named routes; a first run names the key screens.
  const named = existing?.routesKb
    ? Object.keys(existing.routesKb)
    : ["/s/[slug]", "/s/[slug]/o/[token]", "/", "/sign-in", "/orders", "/pos", "/menu", "/transactions", "/drops/[id]"];
  const missing = named.filter((r) => !routes.has(r));
  if (missing.length > 0) {
    console.error(`bundle budget: routes no longer in the build: ${missing.join(", ")} — remove them from perf-budget.json.`);
    process.exit(2);
  }
  const worst = Math.max(...routes.values());
  const next = {
    $comment:
      "First-load JS budgets in kB gzip (1 kB = 1000 B), checked by scripts/check-bundle-budget.mjs after `npm run build`. " +
      "Re-record with `npm run perf:budget -- --update` only for a growth you can justify; see docs/PERFORMANCE.md.",
    headroomPercent: headroom,
    sharedKb: withRoom(kb(sharedBytes)),
    anyRouteKb: withRoom(kb(worst)),
    routesKb: Object.fromEntries(named.map((r) => [r, withRoom(kb(routes.get(r)))])),
  };
  fs.writeFileSync(budgetPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`bundle budget: wrote ${path.relative(root, budgetPath)} (measured + ${headroom}%).`);
  process.exit(0);
}

if (!existing) {
  console.error("bundle budget: perf-budget.json is missing — create it with `npm run perf:budget -- --update`.");
  process.exit(2);
}

const failures = [];
const rows = [];
function check(label, actualKb, budgetKb) {
  const over = actualKb > budgetKb;
  rows.push({ what: label, "kB gzip": actualKb, budget: budgetKb, "used %": Math.round((actualKb / budgetKb) * 100), ok: over ? "OVER" : "ok" });
  if (over) failures.push(`${label}: ${actualKb} kB > budget ${budgetKb} kB (+${(actualKb - budgetKb).toFixed(1)} kB)`);
}

check("shared by all pages", measured.sharedKb, existing.sharedKb);
for (const [route, budgetKb] of Object.entries(existing.routesKb ?? {})) {
  if (!routes.has(route)) {
    failures.push(`${route}: in perf-budget.json but not in the build — renamed or removed? Update the budget file.`);
    continue;
  }
  check(route, measured.routesKb[route], budgetKb);
}
if (typeof existing.anyRouteKb === "number") {
  const [worstRoute, worstBytes] = [...routes.entries()].sort((a, b) => b[1] - a[1])[0];
  check(`heaviest route (${worstRoute})`, kb(worstBytes), existing.anyRouteKb);
}

console.table(rows);

if (failures.length > 0) {
  console.error("\nBundle budget exceeded:\n  - " + failures.join("\n  - "));
  console.error(
    "\nFind what grew with `ANALYZE=true npm run build` (.next/analyze/client.html).\n" +
      "Usual causes: a library imported into a layout or a client component that every page loads,\n" +
      "a value import from @prisma/client in client code, or a modal that could be next/dynamic.\n" +
      "If the growth is intended: `npm run build && npm run perf:budget -- --update`, and say why in the PR.",
  );
  process.exit(1);
}
console.log("Bundle budget OK.");
