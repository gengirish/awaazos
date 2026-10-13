import type { StaffRole } from "@prisma/client";
import { redirect } from "next/navigation";

import { BillingLockedCard } from "@/components/billing/BillingLockedCard";
import { TrialNotice } from "@/components/billing/TrialNotice";
import { PosShell } from "@/components/pos/PosShell";
import { getIstTodayStart } from "@/lib/billing-period";
import { loadResolvedOffers } from "@/lib/offers-server";
import { prisma } from "@/lib/prisma";
import type { BillingAccess } from "@/lib/plan";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  let vendorId: string;
  let staffRole: StaffRole;
  let access: BillingAccess;
  try {
    const ctx = await requireVendorRole("CASHIER");
    vendorId = ctx.vendor.id;
    staffRole = ctx.staff.role;
    access = ctx.access;
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/sign-in");
    }
    throw e;
  }

  // Trial over and not subscribed: no till. POST /api/transactions enforces it.
  // `data-pos-page` (here and on PosShell) tells public/sw.js this response is
  // a fully rendered /pos — the only kind it may keep as the offline copy.
  if (access.kind === "locked") {
    return (
      <div data-pos-page="locked">
        <BillingLockedCard since={access.since} staffRole={staffRole} />
      </div>
    );
  }

  const today = getIstTodayStart();

  const [offers, daily, menuItems, vendorRecord] = await Promise.all([
    // Offers live at the counter right now. The page (and its offline copy)
    // previews with these; POST /api/transactions re-prices every live sale.
    loadResolvedOffers(prisma, vendorId, { channel: "POS" }),
    prisma.dailySummary.findUnique({
      where: { vendorId_date: { vendorId, date: today } },
    }),
    prisma.menuItem.findMany({
      where: { vendorId, isAvailable: true },
      orderBy: [{ isPopular: "desc" }, { sortOrder: "asc" }],
      select: {
        id: true,
        name: true,
        emoji: true,
        imageUrl: true,
        priceInPaise: true,
        isPopular: true,
        category: true,
      },
    }),
    prisma.vendor.findUnique({
      where: { id: vendorId },
      include: { settings: true },
    }),
  ]);

  if (!vendorRecord) {
    redirect("/sign-in");
  }

  const s = vendorRecord.settings;
  const settings = {
    voiceLang: s?.voiceLang ?? "en-IN",
    taxEnabled: s?.taxEnabled ?? false,
    taxPercent: s?.taxPercent != null ? String(s.taxPercent) : "0",
    autoPrintReceipt: s?.autoPrintReceipt ?? false,
    offers,
  };

  const todaysRevenuePaise = daily?.totalRevenuePaise ?? 0;

  const initialItems = menuItems.map((it) => ({
    id: it.id,
    name: it.name,
    emoji: it.emoji,
    imageUrl: it.imageUrl,
    priceInPaise: it.priceInPaise,
    isPopular: it.isPopular,
    category: it.category,
  }));

  return (
    <>
      {access.kind === "trial" ? (
        <TrialNotice
          endsAt={access.endsAt}
          now={new Date()}
          isOwner={staffRole === "OWNER"}
        />
      ) : null}
      <PosShell
        vendor={{
          id: vendorRecord.id,
          name: vendorRecord.name,
          upiId: vendorRecord.upiId,
          upiName: vendorRecord.upiName,
        }}
        initialItems={initialItems}
        settings={settings}
        todaysRevenuePaise={todaysRevenuePaise}
        renderedAt={new Date().toISOString()}
      />
    </>
  );
}
