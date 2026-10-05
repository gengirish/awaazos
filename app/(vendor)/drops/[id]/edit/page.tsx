import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DropForm, DropStatusControls } from "@/components/drops/DropForm";
import { ShareDropButton } from "@/components/drops/ShareDropButton";
import { allowedTransitions, liveDropOrderWhere } from "@/lib/drops-api";
import { dropToFormInput } from "@/lib/drops-builder";
import { effectiveDropStatus, soldQtyByDropItem } from "@/lib/drops";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function EditDropPage({ params }: { params: { id: string } }) {
  let vendor: { id: string; name: string; slug: string };
  try {
    const ctx = await requireVendorRole("MANAGER");
    vendor = { id: ctx.vendor.id, name: ctx.vendor.name, slug: ctx.vendor.slug };
  } catch (e) {
    if (e instanceof AuthError) redirect(e.status === 403 ? "/pos" : "/sign-in");
    throw e;
  }

  const drop = await prisma.drop.findFirst({
    where: { id: params.id, vendorId: vendor.id },
    include: { items: { include: { menuItem: { select: { name: true } } } } },
  });
  if (!drop) notFound();

  const now = new Date();
  const [menuItems, sold, orderCount] = await Promise.all([
    prisma.menuItem.findMany({
      where: { vendorId: vendor.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, emoji: true, priceInPaise: true, isAvailable: true },
    }),
    soldQtyByDropItem(prisma, drop.id, now),
    prisma.transaction.count({ where: { vendorId: vendor.id, dropId: drop.id, ...liveDropOrderWhere } }),
  ]);

  const soldByMenuItem: Record<string, number> = {};
  for (const i of drop.items) {
    const q = sold.get(i.id);
    if (q) soldByMenuItem[i.menuItemId] = q;
  }

  const effectiveStatus = effectiveDropStatus(drop, now);
  const locked = drop.status === "FROZEN" || drop.status === "FULFILLED";
  const itemNames = [...drop.items].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.menuItem.name);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <header className="mx-auto mb-6 flex max-w-2xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold text-foreground">{drop.title}</h1>
          <p className="text-sm text-muted-foreground">Edit drop</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/drops"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            All drops
          </Link>
          <Link
            href={`/drops/${drop.id}`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Orders ({orderCount})
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6">
        <DropStatusControls
          dropId={drop.id}
          effectiveStatus={effectiveStatus}
          allowedTransitions={allowedTransitions(drop, now)}
          orderCount={orderCount}
        />

        {effectiveStatus === "OPEN" || effectiveStatus === "SCHEDULED" ? (
          <ShareDropButton
            vendorName={vendor.name}
            vendorSlug={vendor.slug}
            dropTitle={drop.title}
            closesAt={drop.closesAt.toISOString()}
            fulfilmentStartsAt={drop.fulfilmentStartsAt.toISOString()}
            fulfilmentEndsAt={drop.fulfilmentEndsAt.toISOString()}
            fulfilmentMode={drop.fulfilmentMode}
            itemNames={itemNames}
          />
        ) : null}

        <DropForm
          key={drop.updatedAt.toISOString()}
          dropId={drop.id}
          menuItems={menuItems}
          initial={dropToFormInput(drop)}
          locked={locked}
          soldByMenuItem={soldByMenuItem}
        />
      </main>
    </div>
  );
}
