import { redirect } from "next/navigation";

import { PosShell } from "@/components/pos/PosShell";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

function startOfTodayIST(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

export default async function PosPage() {
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

  const today = startOfTodayIST();

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
    <PosShell
      vendor={{
        id: vendorRecord.id,
        name: vendorRecord.name,
        slug: vendorRecord.slug,
        upiId: vendorRecord.upiId,
        upiName: vendorRecord.upiName,
      }}
      initialItems={initialItems}
      settings={settings}
      todaysRevenuePaise={todaysRevenuePaise}
    />
  );
}
