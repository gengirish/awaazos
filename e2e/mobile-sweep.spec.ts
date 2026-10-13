import fs from "node:fs";
import path from "node:path";

import { expect, test, type Cookie, type Page, type TestInfo } from "@playwright/test";

import {
  MIN_TAP_PX,
  OUTPUT_DIR,
  UPDATE_BASELINE,
  auditPage,
  compareWithBaseline,
  ensureDir,
  readBaseline,
  slugForRoute,
  writeBaselineEntry,
  type PageAudit,
} from "./helpers/mobile-sweep";
import { CONTEXT_OPTIONS, createMenuItem, createVendorSession, type MenuItemRow } from "./helpers/vendor";

/**
 * Mobile baseline sweep.
 *
 * Every vendor and public screen, at three widths, measured for the two things
 * that make a page unusable on a phone: horizontal overflow and tap targets
 * under 44x44 CSS px. A full-page screenshot of each lands in
 * `test-results/mobile-baseline/<project>/`.
 *
 * The app has known violations, so this is a ratchet, not a gate: whatever is
 * listed in `e2e/mobile-sweep.baseline.json` is tolerated, anything new fails,
 * and anything that has been fixed is logged so the baseline can be tightened.
 *
 *   npx playwright test e2e/mobile-sweep.spec.ts                       # check
 *   MOBILE_SWEEP_UPDATE=1 npx playwright test e2e/mobile-sweep.spec.ts --workers=1   # re-record
 *
 * Writes real rows — run against a throwaway Postgres only (see CLAUDE.md).
 */

// One worker, in order, sharing one seeded vendor — but (unlike "serial") a
// failing route does not skip the routes after it.
test.describe.configure({ mode: "default" });

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
] as const;
const OVERLAY_VIEWPORT = VIEWPORTS[1];

const SAVE_SCREENSHOTS = process.env.MOBILE_SWEEP_SCREENSHOTS !== "0";
const JSON_HEADERS = { "Content-Type": "application/json" };
const STORE_NAME = "Sweep Kitchen";
const DROP_TITLE = "Weekend bakes";

type Seed = {
  cookies: Cookie[];
  slug: string;
  dropId: string;
  /** Per-run strings that must never reach a baseline signature. */
  volatile: string[];
};

let seed: Seed | null = null;
const baseline = readBaseline();

/** YYYY-MM-DD in IST, `days` from today. */
function istYmd(days: number): string {
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000 + days * 24 * 60 * 60 * 1000);
  return istNow.toISOString().slice(0, 10);
}

/**
 * One vendor that looks like a kitchen in use: six dishes in two categories, a
 * published storefront taking menu orders, an open drop with one order, one
 * menu order and one counter sale.
 */
async function seedVendor(page: Page): Promise<Seed> {
  const creds = await createVendorSession(page, page.request, "mobile-sweep", "/menu");

  const menu: MenuItemRow[] = [];
  for (const [name, priceInRupees, category] of [
    ["Samosa", 20, "Snacks"],
    ["Vada Pav", 25, "Snacks"],
    ["Masala Dosa", 80, "Snacks"],
    ["Masala Chai", 15, "Drinks"],
    ["Filter Coffee", 20, "Drinks"],
    ["Mango Lassi", 60, "Drinks"],
  ] as const) {
    menu.push(await createMenuItem(page, { name, priceInRupees, category }));
  }

  // A fixed display name keeps text-sized controls the same width on every run
  // (the slug stays random and is scrubbed from signatures instead).
  const settings = await page.request.patch("/api/vendor", {
    data: {
      name: STORE_NAME,
      publishStorefront: true,
      upiId: "sweep-kitchen@okaxis",
      upiName: STORE_NAME,
      acceptPayOnDelivery: true,
      acceptMenuOrders: true,
    },
    headers: JSON_HEADERS,
  });
  expect(settings.status(), "PATCH /api/vendor (publish storefront, payments, menu orders)").toBe(200);

  const vendorRes = await page.request.get("/api/vendor");
  expect(vendorRes.status(), "GET /api/vendor").toBe(200);
  const { vendor } = (await vendorRes.json()) as { vendor: { slug: string } };

  // Cooking day is the day after tomorrow, orders close tomorrow 21:00 IST —
  // always open, whatever time the suite runs.
  const [samosa, , dosa] = menu;
  const dropRes = await page.request.post("/api/drops", {
    data: {
      title: DROP_TITLE,
      note: "Fresh on Saturday evening.",
      date: istYmd(2),
      fulfilmentMode: "BOTH",
      fulfilmentStart: "17:00",
      fulfilmentEnd: "19:00",
      pickupNote: "Gate 2, ring the bell",
      deliveryFeePaise: 3000,
      closesAtDate: istYmd(1),
      closesAtTime: "21:00",
      showEverydayMenu: true,
      items: [
        { menuItemId: samosa.id, priceInPaise: samosa.priceInPaise, maxQty: 20, perOrderLimit: 5 },
        { menuItemId: dosa.id, priceInPaise: dosa.priceInPaise },
      ],
    },
    headers: JSON_HEADERS,
  });
  expect(dropRes.status(), "POST /api/drops").toBe(201);
  const dropId = ((await dropRes.json()) as { data: { id: string } }).data.id;

  const open = await page.request.patch(`/api/drops/${dropId}/status`, {
    data: { status: "OPEN" },
    headers: JSON_HEADERS,
  });
  expect(open.status(), "open the drop").toBe(200);

  const dropDetail = await page.request.get(`/api/drops/${dropId}`);
  expect(dropDetail.status(), "GET /api/drops/[id]").toBe(200);
  const dropItems = ((await dropDetail.json()) as { data: { items: { id: string }[] } }).data.items;

  const buyer = {
    customerName: "Priya Buyer",
    customerPhone: "98480 12345",
    fulfilmentType: "PICKUP",
    paymentMethod: "CASH",
  };
  const dropOrder = await page.request.post(`/api/s/${vendor.slug}/orders`, {
    data: { ...buyer, dropId, items: [{ dropItemId: dropItems[0].id, qty: 2 }] },
    headers: JSON_HEADERS,
  });
  expect(dropOrder.status(), "storefront drop order").toBe(201);

  const menuOrder = await page.request.post(`/api/s/${vendor.slug}/menu-orders`, {
    data: { ...buyer, items: [{ menuItemId: menu[3].id, qty: 2 }] },
    headers: JSON_HEADERS,
  });
  expect(menuOrder.status(), "storefront menu order").toBe(201);

  const sale = await page.request.post("/api/transactions", {
    data: {
      items: [{ menuItemId: samosa.id, name: samosa.name, priceInPaise: samosa.priceInPaise, qty: 2 }],
      subtotalPaise: samosa.priceInPaise * 2,
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: samosa.priceInPaise * 2,
      paymentMethod: "CASH",
      source: "MANUAL",
    },
    headers: JSON_HEADERS,
  });
  expect(sale.status(), "POS sale").toBe(201);

  return {
    cookies: await page.context().cookies(),
    slug: vendor.slug,
    dropId,
    volatile: [creds.stallName, creds.email, vendor.slug],
  };
}

/** Carry the seeded vendor's session (and a dismissed cookie banner) into this test's page. */
async function prepare(page: Page, opts: { signedIn: boolean; cookieBanner?: boolean }): Promise<Seed> {
  if (!seed) throw new Error("mobile sweep: vendor seeding did not finish");
  if (opts.signedIn) await page.context().addCookies(seed.cookies);
  if (!opts.cookieBanner) {
    await page.addInitScript(() => {
      window.localStorage.setItem("awz_cookie_pref_v1", "accepted");
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  return seed;
}

/** Wait until the page has stopped moving: data loaded, fonts in, no transitions mid-flight. */
async function settle(page: Page): Promise<void> {
  // Not "networkidle": next dev and the boards keep connections open, so it
  // only ever resolves by timing out. Watch the layout itself instead.
  await page.waitForLoadState("load");
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;" +
      "transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}",
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const snapshot = () =>
      [
        document.querySelectorAll("*").length,
        document.documentElement.scrollHeight,
        document.documentElement.scrollWidth,
        // Skeletons and spinners mean client data is still on its way.
        document.querySelectorAll('[aria-busy="true"], .animate-pulse, .animate-spin').length,
      ].join("/");
    const deadline = Date.now() + 15_000;
    let last = "";
    let stable = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      const now = snapshot();
      const loading = now.endsWith("/0") === false;
      stable = now === last && !loading ? stable + 1 : 0;
      last = now;
      if (stable >= 4) break; // unchanged for a full second
    }
  });
}

/**
 * Record or check one (route, width). Never throws on a violation — failures
 * are soft so one run reports every width of every route.
 */
async function judge(
  page: Page,
  testInfo: TestInfo,
  s: Seed,
  routeKey: string,
  width: number,
  opts: { rootSelector?: string; fullPage: boolean },
): Promise<PageAudit> {
  const project = testInfo.project.name;
  const key = `${routeKey}@${width}`;
  const audit = await auditPage(page, opts.rootSelector ?? null);
  const dir = path.join(OUTPUT_DIR, project);
  const slug = `${slugForRoute(routeKey)}-${width}`;
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ key, ...audit }, null, 2));
  if (SAVE_SCREENSHOTS) {
    await page.screenshot({ path: path.join(dir, `${slug}.png`), fullPage: opts.fullPage, animations: "disabled" });
  }

  if (UPDATE_BASELINE) {
    writeBaselineEntry(project, key, audit, s.volatile);
    return audit;
  }

  const { regressions, fixed } = compareWithBaseline(baseline, project, key, audit, s.volatile);
  for (const line of fixed) {
    // Not a failure: good news that the baseline has not caught up with.
    console.log(`[mobile-sweep] ${project} ${key}: baselined violation no longer present — ${line}`);
    testInfo.annotations.push({ type: "mobile-sweep-fixed", description: `${key}: ${line}` });
  }
  expect
    .soft(
      regressions,
      `${key}: mobile violations that are not in e2e/mobile-sweep.baseline.json.\n` +
        `Fix them, or (if intended) re-record with MOBILE_SWEEP_UPDATE=1.\n  - ${regressions.join("\n  - ")}`,
    )
    .toEqual([]);
  return audit;
}

type Route = {
  /** Stable name used for baseline keys and screenshot file names. */
  key: string;
  path: (s: Seed) => string;
};

const VENDOR_ROUTES: Route[] = [
  { key: "/pos", path: () => "/pos" },
  { key: "/orders", path: () => "/orders" },
  { key: "/drops", path: () => "/drops" },
  { key: "/drops/new", path: () => "/drops/new" },
  { key: "/orders?drop=[id]", path: (s) => `/orders?drop=${s.dropId}` },
  { key: "/menu", path: () => "/menu" },
  { key: "/transactions", path: () => "/transactions" },
  { key: "/analytics", path: () => "/analytics" },
  { key: "/settings", path: () => "/settings" },
  ...["store", "orders", "offers", "payments", "receipts", "notifications", "voice", "billing"].map((sub) => ({
    key: `/settings/${sub}`,
    path: () => `/settings/${sub}`,
  })),
];

const PUBLIC_ROUTES: Route[] = [
  { key: "/", path: () => "/" },
  { key: "/pricing", path: () => "/pricing" },
  { key: "/sign-in", path: () => "/sign-in" },
  { key: "/sign-up", path: () => "/sign-up" },
  { key: "/s/[slug]", path: (s) => `/s/${s.slug}` },
];

async function sweepRoute(
  page: Page,
  testInfo: TestInfo,
  s: Seed,
  route: Route,
  opts: { signedIn: boolean },
): Promise<void> {
  const target = route.path(s);
  for (const [i, viewport] of VIEWPORTS.entries()) {
    // One page per width. A full-page screenshot of a page taller than the
    // viewport makes Chromium drop touch emulation for the rest of that page's
    // life: `(pointer: coarse)` stops matching, so the next width would be
    // measured (and photographed) with desktop-sized controls.
    const p = i === 0 ? page : await page.context().newPage();
    if (i > 0) await prepare(p, opts);
    await p.setViewportSize(viewport);
    const res = await p.goto(target, { timeout: 120_000 });
    expect(res?.status(), `${target} should load`).toBeLessThan(400);
    const landed = new URL(p.url());
    expect(landed.pathname + landed.search, `${target} should not redirect`).toBe(target);
    await settle(p);
    await judge(p, testInfo, s, route.key, viewport.width, { fullPage: true });
    if (i > 0) await p.close();
  }
}

test.describe("mobile baseline sweep", () => {
  test.beforeAll(async ({ browser }) => {
    // next dev compiles sign-in, the menu page and half a dozen API routes here.
    test.setTimeout(600_000);
    const context = await browser.newContext(CONTEXT_OPTIONS);
    try {
      seed = await seedVendor(await context.newPage());
    } finally {
      await context.close();
    }
  });

  test.describe("vendor screens", () => {
    for (const route of VENDOR_ROUTES) {
      test(`${route.key} — no overflow, 44px tap targets`, async ({ page }, testInfo) => {
        test.setTimeout(300_000);
        const s = await prepare(page, { signedIn: true });
        await sweepRoute(page, testInfo, s, route, { signedIn: true });
      });
    }
  });

  test.describe("public screens", () => {
    for (const route of PUBLIC_ROUTES) {
      test(`${route.key} — no overflow, 44px tap targets`, async ({ page }, testInfo) => {
        test.setTimeout(300_000);
        const s = await prepare(page, { signedIn: false });
        await sweepRoute(page, testInfo, s, route, { signedIn: false });
      });
    }
  });

  test.describe("overlays at 390px", () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(300_000);
      await page.setViewportSize(OVERLAY_VIEWPORT);
    });

    test("menu — add item dialog", async ({ page }, testInfo) => {
      const s = await prepare(page, { signedIn: true });
      await page.goto("/menu", { timeout: 120_000 });
      await page.getByRole("button", { name: "Add item", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await judge(page, testInfo, s, "/menu (add item dialog)", OVERLAY_VIEWPORT.width, {
        rootSelector: '[role="dialog"]',
        fullPage: false,
      });
    });

    test("pos — collect payment sheet", async ({ page }, testInfo) => {
      const s = await prepare(page, { signedIn: true });
      await page.goto("/pos", { timeout: 120_000 });
      await expect(page.getByRole("heading", { name: "Quick add" })).toBeVisible();
      await page.getByRole("button", { name: /^Samosa/ }).click();
      await page.getByRole("button", { name: /Collect payment/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await judge(page, testInfo, s, "/pos (collect payment sheet)", OVERLAY_VIEWPORT.width, {
        rootSelector: '[role="dialog"]',
        fullPage: false,
      });
    });

    test("home — first visit, cookie banner showing", async ({ page }, testInfo) => {
      const s = await prepare(page, { signedIn: false, cookieBanner: true });
      await page.goto("/", { timeout: 120_000 });
      await expect(page.getByRole("dialog", { name: "Cookie consent" })).toBeVisible();
      await settle(page);
      await judge(page, testInfo, s, "/ (cookie banner)", OVERLAY_VIEWPORT.width, {
        rootSelector: '[role="dialog"]',
        fullPage: false,
      });
    });
  });

  test("baseline file matches this build's tap-target minimum", () => {
    test.skip(UPDATE_BASELINE, "re-recording");
    expect(baseline.minTapPx, "e2e/mobile-sweep.baseline.json was recorded for a different minimum").toBe(MIN_TAP_PX);
  });
});
