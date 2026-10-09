import type { Metadata } from "next";
import Link from "next/link";

import { ReceiptSettingsClient } from "@/components/settings/ReceiptSettingsClient";
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { prisma } from "@/lib/prisma";
import { vendorLocationLine } from "@/lib/receipt";

import { requireSettingsContext } from "../_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Receipts · Settings · AwaazOS" };

export default async function ReceiptSettingsPage() {
  const { vendor, isOwner } = await requireSettingsContext();

  const settings = await prisma.vendorSettings.findUnique({
    where: { vendorId: vendor.id },
    select: { receiptFooter: true, autoPrintReceipt: true, receiptPaper: true, fssaiNumber: true },
  });

  return (
    <>
      <SettingsPageHeader
        title="Receipts"
        description="Every bill gets a receipt you can send on WhatsApp, print, or share as a link."
      />
      <SettingsCard
        title="Receipt details"
        description={
          <>
            Shop name and city come from your profile. The FSSAI number is set under{" "}
            <Link href="/settings/store" className="font-medium text-primary underline-offset-4 hover:underline">
              Online store
            </Link>
            .
          </>
        }
      >
        <ReceiptSettingsClient
          initial={{
            receiptFooter: settings?.receiptFooter ?? "",
            gstin: vendor.gstin ?? "",
            autoPrintReceipt: settings?.autoPrintReceipt ?? false,
            receiptPaper: settings?.receiptPaper ?? "MM80",
          }}
          vendorName={vendor.name}
          vendorLocation={vendorLocationLine(vendor.city, vendor.state)}
          fssaiNumber={settings?.fssaiNumber ?? null}
          isOwner={isOwner}
        />
      </SettingsCard>
    </>
  );
}
