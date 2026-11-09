import { expect, test } from "@playwright/test";

import type { UserRole } from "@prisma/client";

import { CAN_SET_BILLING, setPlatformRole } from "./helpers/billing-db";
import { createVendorSession } from "./helpers/vendor";

/**
 * Who opens which /admin page. Pages call `requirePlatformRole(min)`
 * (USER < SALES < ADMIN < SUPER_ADMIN) and answer 404 to anyone else, so a lower
 * role can't learn a page exists; a few also shut out a role above the minimum
 * (/admin/earnings is SALES' own share or a SUPER_ADMIN's view of everyone's,
 * never an ADMIN's). The table lists who opens each page: a new admin page joins
 * it, and a guard that drifts (a SUPER_ADMIN page left at ADMIN) fails here.
 */

type AdminRole = Exclude<UserRole, "USER">;

const ADMIN_PAGES: readonly { path: string; open: readonly AdminRole[] }[] = [
  { path: "/admin/demo-stores", open: ["SALES", "ADMIN", "SUPER_ADMIN"] },
  { path: "/admin/demo-stores/new", open: ["SALES", "ADMIN", "SUPER_ADMIN"] },
  { path: "/admin/earnings", open: ["SALES", "SUPER_ADMIN"] },
  { path: "/admin/metrics", open: ["ADMIN", "SUPER_ADMIN"] },
  { path: "/admin/bets", open: ["ADMIN", "SUPER_ADMIN"] },
  { path: "/admin/communities", open: ["ADMIN", "SUPER_ADMIN"] },
  { path: "/admin/pricing", open: ["ADMIN", "SUPER_ADMIN"] },
  { path: "/admin/admins", open: ["SUPER_ADMIN"] },
  { path: "/admin/vendors", open: ["SUPER_ADMIN"] },
  { path: "/admin/referrals", open: ["SUPER_ADMIN"] },
  { path: "/admin/survey", open: ["SUPER_ADMIN"] },
];

test.describe("admin pages by platform role", () => {
  test("a store owner with no platform role gets 404 on every admin page", async ({ page, request }) => {
    test.slow();
    await createVendorSession(page, request, "admin-matrix-user");
    for (const { path } of ADMIN_PAGES) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });

  test.describe("with roles set in the database", () => {
    test.skip(!CAN_SET_BILLING, "needs a local throwaway database to set a platform role");

    for (const role of ["SALES", "ADMIN", "SUPER_ADMIN"] as const) {
      test(`${role} opens its pages and gets 404 on the rest`, async ({ page, request }) => {
        // Ten pages, each compiled on first hit under `next dev`.
        test.slow();
        const creds = await createVendorSession(page, request, `admin-matrix-${role.toLowerCase()}`);
        await setPlatformRole(creds.email, role);

        for (const { path, open } of ADMIN_PAGES) {
          const res = await page.goto(path);
          const allowed = open.includes(role);
          expect(res?.status(), `${role} → ${path}`).toBe(allowed ? 200 : 404);
          if (allowed) await expect(page.getByRole("heading", { level: 1 }).first(), path).toBeVisible();
        }
      });
    }
  });
});
