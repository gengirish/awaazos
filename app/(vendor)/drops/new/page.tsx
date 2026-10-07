import Link from "next/link";
import { redirect } from "next/navigation";

import { DropForm } from "@/components/drops/DropForm";
import { istTodayYmd, istTomorrowYmd } from "@/lib/drops-builder";
import { utcToIstParts } from "@/lib/drops-time";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import type { DropUpsertInput } from "@/lib/zod-drops";

export const dynamic = "force-dynamic";

export default async function NewDropPage() {
  let vendorId: string;
  try {
    const ctx = await requireVendorRole("MANAGER");
    vendorId = ctx.vendor.id;
  } catch (e) {
    if (e instanceof AuthError) redirect(e.status === 403 ? "/pos" : "/sign-in");
    throw e;
  }

  const menuItems = await prisma.menuItem.findMany({
    where: { vendorId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, emoji: true, priceInPaise: true, isAvailable: true },
  });

  // Sensible default: cook tomorrow 5–8 pm, orders close tonight at 9 pm —
  // or tomorrow 10 am if it's already late tonight.
  const now = new Date();
  const tomorrow = istTomorrowYmd(now);
  const lateTonight = utcToIstParts(now).hm >= "20:00";
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
    closesAtDate: lateTonight ? tomorrow : istTodayYmd(now),
    closesAtTime: lateTonight ? "10:00" : "21:00",
    // A drop appears on its own unless the vendor opts in.
    showEverydayMenu: false,
    items: [],
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <header className="mx-auto mb-6 flex max-w-2xl items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">New drop</h1>
          <p className="text-sm text-muted-foreground">Pick what you&apos;re cooking and when customers can order.</p>
        </div>
        <Link
          href="/drops"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Cancel
        </Link>
      </header>
      <main className="mx-auto max-w-2xl">
        <DropForm menuItems={menuItems} initial={initial} />
      </main>
    </div>
  );
}
