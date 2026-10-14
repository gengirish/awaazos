import Link from "next/link";
import { redirect } from "next/navigation";

import { DropForm } from "@/components/drops/DropForm";
import { defaultCutoffFor, istTomorrowYmd } from "@/lib/drops-builder";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import type { DropUpsertInput } from "@/lib/zod-drops";

export const dynamic = "force-dynamic";

export default async function NewDropPage() {
  let vendorId: string;
  let vendorSlug: string;
  let isOwner: boolean;
  try {
    const ctx = await requireVendorRole("MANAGER");
    vendorId = ctx.vendor.id;
    vendorSlug = ctx.vendor.slug;
    isOwner = ctx.staff.role === "OWNER";
  } catch (e) {
    if (e instanceof AuthError) redirect(e.status === 403 ? "/pos" : "/sign-in");
    throw e;
  }

  const [menuItems, settings] = await Promise.all([
    prisma.menuItem.findMany({
      where: { vendorId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, emoji: true, priceInPaise: true, isAvailable: true },
    }),
    prisma.vendorSettings.findUnique({ where: { vendorId }, select: { voiceLang: true, publishStorefront: true } }),
  ]);

  // Sensible default: cook tomorrow 5–8 pm, orders close the evening before at
  // 9 pm — or the cooking-day morning if that evening is already (nearly) gone.
  // DropForm moves the cut-off along when the vendor changes the cooking day.
  const now = new Date();
  const tomorrow = istTomorrowYmd(now);
  const cutoff = defaultCutoffFor(tomorrow, now);
  const initial: DropUpsertInput = {
    title: "",
    note: null,
    date: tomorrow,
    fulfilmentMode: "DELIVERY",
    fulfilmentStart: "17:00",
    fulfilmentEnd: "20:00",
    pickupNote: null,
    deliveryFeePaise: 0,
    opensAtDate: null,
    opensAtTime: null,
    closesAtDate: cutoff.closesAtDate,
    closesAtTime: cutoff.closesAtTime,
    // A drop appears on its own unless the vendor opts in.
    showEverydayMenu: false,
    items: [],
  };

  return (
    <div className="bg-background p-4 md:p-6">
      <header className="mx-auto mb-6 flex max-w-2xl items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">New drop</h1>
          <p className="text-sm text-muted-foreground">Pick what you&apos;re cooking and when customers can order.</p>
        </div>
        <Link
          href="/drops"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Cancel
        </Link>
      </header>
      <main className="mx-auto max-w-2xl">
        <DropForm
          menuItems={menuItems}
          initial={initial}
          voiceLang={settings?.voiceLang ?? "en-IN"}
          isOwner={isOwner}
          openFlow={{ storePublished: settings?.publishStorefront ?? false, storePath: `/s/${vendorSlug}` }}
        />
      </main>
    </div>
  );
}
