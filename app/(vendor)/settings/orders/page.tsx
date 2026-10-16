import { CalendarClock, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DeliveryRidersClient } from "@/components/settings/DeliveryRidersClient";
import { MenuOrdersClient } from "@/components/settings/MenuOrdersClient";
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { WhatsappOrdersClient } from "@/components/settings/WhatsappOrdersClient";
import { parseDeliveryRiders } from "@/lib/delivery-riders";
import { prisma } from "@/lib/prisma";

import { requireSettingsContext } from "../_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Online orders · Settings · AwaazOS" };

export default async function OrdersSettingsPage() {
  const { vendor, isOwner } = await requireSettingsContext();

  const settings = await prisma.vendorSettings.findUnique({
    where: { vendorId: vendor.id },
    select: {
      acceptMenuOrders: true,
      menuFulfilmentMode: true,
      menuDeliveryFeePaise: true,
      menuPickupNote: true,
      whatsappNumber: true,
      acceptWhatsappOrders: true,
      showWhatsappOnStore: true,
      deliveryRiders: true,
    },
  });

  return (
    <>
      <SettingsPageHeader
        title="Online orders"
        description="Let customers order your everyday menu from your store page, any time. No Drop needed."
      />
      <div className="space-y-4">
        <SettingsCard title="Order from menu">
          <MenuOrdersClient
            slug={vendor.slug}
            initialAcceptMenuOrders={settings?.acceptMenuOrders ?? false}
            initialFulfilmentMode={settings?.menuFulfilmentMode ?? "PICKUP"}
            initialDeliveryFeePaise={settings?.menuDeliveryFeePaise ?? 0}
            initialPickupNote={settings?.menuPickupNote ?? null}
            isOwner={isOwner}
          />
        </SettingsCard>

        <SettingsCard title="WhatsApp">
          <WhatsappOrdersClient
            initialWhatsappNumber={settings?.whatsappNumber ?? null}
            initialAcceptWhatsappOrders={settings?.acceptWhatsappOrders ?? false}
            initialShowOnStore={settings?.showWhatsappOnStore ?? false}
            isOwner={isOwner}
          />
        </SettingsCard>

        <SettingsCard
          title="Delivery riders"
          description="Save the people who deliver for you. Delivery orders then get a “Send to” button that opens WhatsApp to the rider with the address, items and amount to collect."
        >
          <DeliveryRidersClient
            initialRiders={parseDeliveryRiders(settings?.deliveryRiders)}
            isOwner={isOwner}
          />
        </SettingsCard>

        <section
          aria-labelledby="drops-pointer-heading"
          className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/30 p-4"
        >
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="drops-pointer-heading" className="font-semibold">
              Daily pre-orders
            </h2>
            <p className="text-sm text-muted-foreground">
              Pre-orders with a cut-off time and limited stock are set up per drop.
            </p>
            <Link
              href="/drops"
              className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Go to Drops
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
