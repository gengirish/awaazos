import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { createVendorSession } from "./helpers/vendor";

/**
 * Every protected API route refuses a caller who isn't allowed, read straight
 * from `app/api/**\/route.ts` so a route added later is covered without
 * touching this file.
 *
 * - Anonymous: every route outside PUBLIC answers 401 before doing anything
 *   (404 under `/api/admin/**`, which hides itself from everyone below its role).
 * - A store owner with no platform role: every `/api/admin/**` route answers
 *   404 (lib/admin-api.ts hides the admin surface), never 2xx, never 500.
 *
 * A route meant to be reachable without a session goes in PUBLIC with the
 * reason; its own spec covers what it does.
 */

const API_DIR = path.join(__dirname, "..", "app", "api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

/** Path prefixes that are public by design (CLAUDE.md "Public storefront surface", webhooks, health). */
const PUBLIC: { prefix: string; why: string }[] = [
  { prefix: "/api/auth", why: "Auth.js, register, store-handle lookup" },
  { prefix: "/api/s/", why: "public storefront (storefront.spec.ts and friends)" },
  { prefix: "/api/d/", why: "rider link, keyed on riderToken (delivery-riders.spec.ts)" },
  { prefix: "/api/survey", why: "public seller survey (owner-survey.spec.ts)" },
  { prefix: "/api/contact", why: "public contact form, emails our inbox (public.spec.ts)" },
  { prefix: "/api/health", why: "liveness" },
  { prefix: "/api/ready", why: "readiness" },
  { prefix: "/api/webhooks/", why: "HMAC instead of a session (webhooks-machine-auth.spec.ts)" },
  { prefix: "/api/admin-invite", why: "invite token instead of a session; /accept needs one (checked below)" },
  { prefix: "/api/demo-claim", why: "claim token instead of a session" },
  { prefix: "/api/vendor/payments/razorpay/callback", why: "OAuth redirect target, state-checked" },
  { prefix: "/api/vendor/payments/razorpay/connect", why: "browser navigation: sends a signed-out seller to sign-in (checked below)" },
];

type Route = { path: string; methods: Method[] };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name === "route.ts" ? [full] : [];
  });
}

function discoverRoutes(): Route[] {
  return walk(API_DIR)
    .map((file) => {
      const src = readFileSync(file, "utf8");
      const methods = METHODS.filter((m) =>
        new RegExp(`export\\s+(async\\s+function\\s+${m}\\b|const\\s+${m}\\s*=|\\{[^}]*\\b${m}\\b[^}]*\\})`).test(src),
      );
      const rel = path.relative(API_DIR, path.dirname(file)).split(path.sep).join("/");
      // Dynamic segments get an id that exists nowhere.
      const urlPath = `/api/${rel}`.replace(/\[\.{0,3}[^\]]+\]/g, "e2e-nonexistent-0000");
      return { path: urlPath, methods };
    })
    .filter((r) => r.methods.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
}

const ROUTES = discoverRoutes();
/** `/api/survey` covers itself and `/api/survey/...`, never `/api/surveys`. */
const isPublic = (p: string) =>
  PUBLIC.some(({ prefix }) => {
    const base = prefix.replace(/\/$/, "");
    return p === base || p.startsWith(`${base}/`);
  });

test.describe("API auth sweep", () => {
  test("route discovery finds the API (sanity)", () => {
    expect(ROUTES.length).toBeGreaterThan(80);
    expect(ROUTES.find((r) => r.path === "/api/transactions")?.methods).toEqual(expect.arrayContaining(["GET", "POST"]));
  });

  test("anonymous callers get 401 from every protected route", async ({ playwright }) => {
    // A fresh context with no cookies at all, not the shared `request` fixture.
    const anon = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    const failures: string[] = [];
    for (const route of ROUTES.filter((r) => !isPublic(r.path))) {
      for (const method of route.methods) {
        const res = await anon.fetch(route.path, {
          method,
          data: method === "GET" || method === "DELETE" ? undefined : {},
          headers: { "Content-Type": "application/json" },
          maxRedirects: 0,
          failOnStatusCode: false,
        });
        const expected = route.path.startsWith("/api/admin/") ? 404 : 401;
        if (res.status() !== expected) failures.push(`${method} ${route.path} → ${res.status()}`);
      }
    }
    await anon.dispose();
    expect(failures, "these routes did not refuse an anonymous caller").toEqual([]);
  });

  test("admin-invite accept needs a session; Connect Razorpay sends a signed-out seller to sign-in", async ({
    playwright,
  }) => {
    const anon = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    const res = await anon.post("/api/admin-invite/accept", { data: { token: "x".repeat(40) } });
    expect(res.status()).toBe(401);

    const connect = await anon.get("/api/vendor/payments/razorpay/connect", { maxRedirects: 0 });
    expect(connect.status()).toBe(303);
    expect(new URL(connect.headers()["location"]).pathname).toBe("/sign-in");
    await anon.dispose();
  });

  test("a store owner gets 404 from every admin route, never data or a 500", async ({ page, request }) => {
    await createVendorSession(page, request, "admin-sweep");
    const failures: string[] = [];
    for (const route of ROUTES.filter((r) => r.path.startsWith("/api/admin/"))) {
      for (const method of route.methods) {
        const res = await page.request.fetch(route.path, {
          method,
          data: method === "GET" || method === "DELETE" ? undefined : {},
          headers: { "Content-Type": "application/json" },
          maxRedirects: 0,
          failOnStatusCode: false,
        });
        if (res.status() !== 404) failures.push(`${method} ${route.path} → ${res.status()}`);
      }
    }
    expect(failures, "admin routes must hide themselves from a store owner (404)").toEqual([]);
  });
});
