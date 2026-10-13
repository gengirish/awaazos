import type { Metadata } from "next";

import { OffersClient } from "@/components/settings/OffersClient";
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { formatDropDayLabel } from "@/lib/drops-time";
import { OFFER_RULE_SELECT, offerToDto } from "@/lib/offers-server";
import { prisma } from "@/lib/prisma";

import { requireSettingsContext } from "../_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Offers · Settings · AwaazOS" };

export default async function OffersSettingsPage() {
  const { vendor, canManage } = await requireSettingsContext();

  const [offers, menuItems, drops] = await Promise.all([
    prisma.offer.findMany({
      where: { vendorId: vendor.id },
      orderBy: [{ createdAt: "asc" }],
      select: OFFER_RULE_SELECT,
    }),
    prisma.menuItem.findMany({
      where: { vendorId: vendor.id, isAvailable: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, tags: true },
    }),
    // Drops an offer can still be attached to: not yet fulfilled, newest first.
    prisma.drop.findMany({
      where: { vendorId: vendor.id, status: { in: ["DRAFT", "OPEN", "CLOSED"] } },
      orderBy: [{ date: "desc" }],
      take: 20,
      select: { id: true, title: true, date: true },
    }),
  ]);

  return (
    <>
      <SettingsPageHeader
        title="Offers"
        description="Give a percentage off when one order has enough of the right items, like a weekly plan."
      />
      <SettingsCard
        title="Your offers"
        description="If an order fits more than one offer, the customer gets the bigger discount, never both."
      >
        <OffersClient
          initialOffers={offers.map(offerToDto)}
          menuItems={menuItems}
          drops={drops.map((d) => ({ id: d.id, title: d.title, dayLabel: formatDropDayLabel(d.date) }))}
          canEdit={canManage}
        />
      </SettingsCard>
    </>
  );
}
