import { CalendarClock, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DeliveryAreasClient } from "@/components/settings/DeliveryAreasClient";
import { DeliveryRidersClient } from "@/components/settings/DeliveryRidersClient";
import { MenuOrdersClient } from "@/components/settings/MenuOrdersClient";
import { MenuSlotsClient } from "@/components/settings/MenuSlotsClient";
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { WhatsappOrdersClient } from "@/components/settings/WhatsappOrdersClient";
import { parseDeliveryAreas } from "@/lib/delivery-areas";
import { parseDeliveryRiders } from "@/lib/delivery-riders";
import { parseMenuSlots } from "@/lib/menu-slots";
import { prisma } from "@/lib/prisma";

import { requireSettingsContext } from "../_context";
import { BRAND_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: `Online orders · Settings · ${BRAND_NAME}` };

export default async function OrdersSettingsPage() {
  const { vendor, isOwner, storeKind, vocab } = await requireSettingsContext();

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
      menuSlots: true,
      deliveryAreas: true,
    },
  });

  return (
    <>
      <SettingsPageHeader
        title="Online orders"
        description={`Let customers order your everyday ${vocab.catalogue} from your store page, any time. No pre-order needed.`}
      />
      <div className="space-y-4">
        <SettingsCard title={vocab.catalogueOrdersTitle}>
          <MenuOrdersClient
            slug={vendor.slug}
            initialAcceptMenuOrders={settings?.acceptMenuOrders ?? false}
            initialFulfilmentMode={settings?.menuFulfilmentMode ?? "PICKUP"}
            initialDeliveryFeePaise={settings?.menuDeliveryFeePaise ?? 0}
            initialPickupNote={settings?.menuPickupNote ?? null}
            isOwner={isOwner}
            storeKind={storeKind}
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
          title="Pickup and delivery times"
          description={`When customers can get an order from your everyday ${vocab.catalogue}. With times set, checkout asks them to pick one, and the time shows on the order. Pre-orders keep their own handover time.`}
        >
          <MenuSlotsClient initialSlots={parseMenuSlots(settings?.menuSlots)} isOwner={isOwner} />
        </SettingsCard>

        <SettingsCard
          title="Delivery areas"
          description="The localities you deliver to, each with its own fee if you like. With areas set, customers pick one at checkout, and the store page lists them. Leave it empty to deliver anywhere."
        >
          <DeliveryAreasClient
            initialAreas={parseDeliveryAreas(settings?.deliveryAreas)}
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
              Pre-orders with a cut-off time and limited stock are set up on the Pre-orders screen.
            </p>
            <Link
              href="/drops"
              className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Go to Pre-orders
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
