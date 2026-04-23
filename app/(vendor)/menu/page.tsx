import type { MenuItem } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MenuGrid } from "@/components/menu/MenuGrid";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export default async function MenuPage() {
  let vendorId: string;
  try {
    const ctx = await requireVendorRole("CASHIER");
    vendorId = ctx.vendor.id;
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/sign-in");
    }
    throw e;
  }

  const items: MenuItem[] = await prisma.menuItem.findMany({
    where: { vendorId },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <>
      <a
        href="#main-menu"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to menu
      </a>
      <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
        <header className="mx-auto mb-6 flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">Menu</h1>
            <p className="text-sm text-muted-foreground">Manage items, order, and availability.</p>
          </div>
          <Link
            href="/pos"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Back to POS
          </Link>
        </header>
        <main id="main-menu" className="mx-auto max-w-5xl">
          <MenuGrid initialItems={items} />
        </main>
      </div>
    </>
  );
}
