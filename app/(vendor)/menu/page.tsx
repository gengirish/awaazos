import type { MenuItem } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MenuGrid } from "@/components/menu/MenuGrid";
import { VoiceMenuPanel } from "@/components/menu/VoiceMenuPanel";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export default async function MenuPage(props: {
  searchParams: Promise<{ add?: string | string[]; voice?: string | string[] }>;
}) {
  // `?add=<name>` (from the voice drop builder's "Add to menu") opens the add form pre-filled.
  // `?voice=1` (from onboarding's "Speak your whole menu") opens the voice panel.
  const { add, voice } = await props.searchParams;
  const prefillName = typeof add === "string" ? add.trim().slice(0, 80) : "";
  const voiceOpen = voice === "1";

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

  const [items, settings]: [MenuItem[], { voiceLang: string } | null] = await Promise.all([
    prisma.menuItem.findMany({
      where: { vendorId },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.vendorSettings.findUnique({ where: { vendorId }, select: { voiceLang: true } }),
  ]);
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];

  return (
    <>
      <a
        href="#main-menu"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-100 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
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
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Back to POS
          </Link>
        </header>
        <main id="main-menu" className="mx-auto max-w-5xl space-y-6">
          <VoiceMenuPanel
            voiceLang={settings?.voiceLang ?? "en-IN"}
            categories={categories}
            itemCount={items.length}
            defaultOpen={voiceOpen}
          />
          <MenuGrid initialItems={items} prefillName={prefillName || undefined} />
        </main>
      </div>
    </>
  );
}
