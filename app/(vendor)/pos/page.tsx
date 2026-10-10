import type { StaffRole } from "@prisma/client";
import { redirect } from "next/navigation";

import { BillingLockedCard } from "@/components/billing/BillingLockedCard";
import { TrialNotice } from "@/components/billing/TrialNotice";
import { PosShell } from "@/components/pos/PosShell";
import { getIstTodayStart } from "@/lib/billing-period";
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
  if (access.kind === "locked") {
    return <BillingLockedCard since={access.since} staffRole={staffRole} />;
  }

  const today = getIstTodayStart();

  const [daily, menuItems, vendorRecord] = await Promise.all([
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
          slug: vendorRecord.slug,
          upiId: vendorRecord.upiId,
          upiName: vendorRecord.upiName,
          storefrontPublished: s?.publishStorefront ?? false,
        }}
        initialItems={initialItems}
        settings={settings}
        todaysRevenuePaise={todaysRevenuePaise}
        renderedAt={new Date().toISOString()}
        staffRole={staffRole}
      />
    </>
  );
}
