import { redirect } from "next/navigation";

import { BillingAccessNotice } from "@/components/billing/TrialNotice";
import { OrdersBannerSlot } from "@/components/drops/orders/OrdersBannerSlot";
import { OrdersBoard } from "@/components/drops/orders/OrdersBoard";
import { SetupChecklistCard } from "@/components/setup/SetupChecklistCard";
import { parseDeliveryRiders } from "@/lib/delivery-riders";
import { loadOrdersBoard } from "@/lib/drops-board-server";
import { getOrderSignal } from "@/lib/drops-signal";
import { prisma } from "@/lib/prisma";
import { shouldAskOwnerSurvey } from "@/lib/owner-survey-server";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { shouldAskToRefer } from "@/lib/referral-server";
import { loadStorePolishNudge } from "@/lib/store-polish-server";
import { loadSetupChecklist } from "@/lib/setup-checklist-server";
import { storeVocabulary } from "@/lib/store-vocabulary";
import { BRAND_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata = { title: `Orders · ${BRAND_NAME}` };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The one orders board: every online order, whether it came from the everyday
 * menu or from a drop. `?drop=<id>` opens it narrowed to that drop.
 */
export default async function OrdersPage(props: Props) {
  const { drop } = await props.searchParams;
  const dropId = (Array.isArray(drop) ? drop[0] : drop) || null;

  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  try {
    ctx = await requireVendorRole("CASHIER");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }

  // Signal first, so an order landing between the reads triggers a refetch.
  const signal = await getOrderSignal(ctx.vendor.id);
  const [settings, board] = await Promise.all([
    prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: {
        acceptMenuOrders: true,
        menuFulfilmentMode: true,
        publishStorefront: true,
        acceptPayOnDelivery: true,
        fssaiNumber: true,
        deliveryRiders: true,
        razorpaySubStatus: true,
        tagline: true,
      },
    }),
    loadOrdersBoard(ctx.vendor.id, { pinDropId: dropId }),
  ]);
  // Why no orders arrive yet, for staff who can fix it. Nothing once set up.
  const [setup, askSurvey, askRefer, polish] = await Promise.all([
    loadSetupChecklist({ vendor: ctx.vendor, role: ctx.staff.role, known: { settings } }),
    shouldAskOwnerSurvey(ctx.vendor, ctx.staff.role),
    shouldAskToRefer({
      vendor: ctx.vendor,
      role: ctx.staff.role,
      access: ctx.access,
      published: settings?.publishStorefront ?? false,
      razorpaySubStatus: settings?.razorpaySubStatus,
    }),
    loadStorePolishNudge(ctx.vendor, ctx.staff.role, {
      published: settings?.publishStorefront ?? false,
      tagline: settings?.tagline ?? null,
    }),
  ]);
  // Steps still open keep the checklist. Once only reminders are left, the
  // first of them competes for the one banner slot with the other prompts.
  const remindersOnly = setup.items.every((item) => item.reminder);
  const vocab = storeVocabulary(ctx.vendor.stallType);

  return (
    <main id="main" className="bg-background p-4 pb-16 md:p-6">
      <a href="#orders-list" className="sr-only focus:not-sr-only">
        Skip to orders
      </a>
      {/*
        Trial countdown, or "customers can't order" once locked. The board below
        stays usable either way: a locked vendor still works existing orders.
      */}
      <BillingAccessNotice
        access={ctx.access}
        isOwner={ctx.staff.role === "OWNER"}
        className="mx-auto mb-3 max-w-3xl"
      />
      {remindersOnly ? null : <SetupChecklistCard {...setup} titleAs="p" className="mx-auto mb-3 max-w-3xl" />}
      <OrdersBannerSlot
        reminder={remindersOnly ? (setup.items[0] ?? null) : null}
        polish={polish}
        catalogue={vocab.catalogue}
        askSurvey={askSurvey}
        askRefer={askRefer}
        className="mx-auto mb-3 max-w-3xl"
      />
      <OrdersBoard
        vendorName={ctx.vendor.name}
        vendorSlug={ctx.vendor.slug}
        acceptMenuOrders={settings?.acceptMenuOrders ?? false}
        menuFulfilmentMode={settings?.menuFulfilmentMode ?? "PICKUP"}
        initialOrders={board.orders}
        initialDrops={board.drops}
        initialDropId={dropId}
        initialSignal={signal}
        staffRole={ctx.staff.role}
        vocab={vocab}
        riders={parseDeliveryRiders(settings?.deliveryRiders)}
      />
    </main>
  );
}
