import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const E2E_PASSWORD = "E2e_vendor_Pass9!";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

/** Context options that mirror playwright.config.ts `use` for manually-created contexts. */
export const CONTEXT_OPTIONS = {
  baseURL: BASE_URL,
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
} as const;

export type VendorCreds = {
  email: string;
  password: string;
  stallName: string;
};

export type MenuItemRow = {
  id: string;
  name: string;
  priceInPaise: number;
  isAvailable: boolean;
};

export type TransactionCreated = {
  transaction: {
    id: string;
    billNumber: string;
    totalPaise: number;
    paymentMethod: string;
    paymentStatus: string;
  };
  receiptNumber: string;
  whatsappQueued: boolean;
};

/**
 * Register a fresh vendor (OWNER) via the public API. Does NOT sign in.
 *
 * Registration is one `prisma.$transaction` creating User + Vendor +
 * VendorSettings + StaffMember(OWNER), so the returned vendor is immediately
 * usable — no onboarding step required before hitting the API.
 */
export async function registerVendor(
  request: APIRequestContext,
  label = "vendor",
): Promise<VendorCreds> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `e2e-${label}-${suffix}@example.com`;
  const stallName = `E2E ${label} ${suffix}`;

  const reg = await request.post("/api/auth/register", {
    data: {
      email,
      password: E2E_PASSWORD,
      name: `E2E ${label}`,
      stallName,
      stallType: "STREET_FOOD",
      phone: "+919876543210",
    },
    headers: { "Content-Type": "application/json" },
  });
  expect(reg.status(), `register ${label} should succeed when DB is available`).toBe(201);

  return { email, password: E2E_PASSWORD, stallName };
}

/** Sign in through the UI so the browser context carries the Auth.js session cookie. */
export async function signIn(
  page: Page,
  creds: VendorCreds,
  callbackUrl = "/menu",
): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("awz_cookie_pref_v1", "accepted");
  });
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/sign-in"), { timeout: 45_000 });
}

/**
 * Register + sign in. After this resolves, `page.request` carries the session
 * cookie, so API calls made through it are authenticated as this vendor.
 */
export async function createVendorSession(
  page: Page,
  request: APIRequestContext,
  label = "vendor",
  callbackUrl = "/menu",
): Promise<VendorCreds> {
  const creds = await registerVendor(request, label);
  await signIn(page, creds, callbackUrl);
  return creds;
}

/** Create a menu item through the authenticated API and return the created row. */
export async function createMenuItem(
  page: Page,
  fields: {
    name: string;
    priceInRupees: number;
    aliasesCsv?: string;
    tagsCsv?: string;
    category?: string;
  },
): Promise<MenuItemRow> {
  const res = await page.request.post("/api/menu", {
    data: fields,
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status(), `create menu item "${fields.name}"`).toBe(201);
  const body = (await res.json()) as { data: MenuItemRow };
  return body.data;
}

/** True when the deployment has Upstash KV wired (idempotency / rate limits active). */
export async function redisConfigured(request: APIRequestContext): Promise<boolean> {
  const res = await request.get("/api/ready", { failOnStatusCode: false });
  const body = (await res.json()) as {
    probes?: { name: string; ok: boolean }[];
  };
  return body.probes?.some((p) => p.name === "redis" && p.ok) ?? false;
}
