import type { Metadata } from "next";

import { FssaiNumberClient } from "@/components/settings/FssaiNumberClient";
import { InstagramHandleClient } from "@/components/settings/InstagramHandleClient";
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { StoreDetailsClient } from "@/components/settings/StoreDetailsClient";
import { StoreHandleClient } from "@/components/settings/StoreHandleClient";
import { StoreImagesClient } from "@/components/settings/StoreImagesClient";
import { StoreNameClient } from "@/components/settings/StoreNameClient";
import { StorefrontClient } from "@/components/settings/StorefrontClient";
import { prisma } from "@/lib/prisma";

import { requireSettingsContext } from "../_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Online store · Settings · AwaazOS" };

export default async function StoreSettingsPage() {
  const { vendor, isOwner } = await requireSettingsContext();

  const [settings, availableItemCount] = await Promise.all([
    prisma.vendorSettings.findUnique({
      where: { vendorId: vendor.id },
      select: { publishStorefront: true, fssaiNumber: true, instagramHandle: true },
    }),
    prisma.menuItem.count({ where: { vendorId: vendor.id, isAvailable: true } }),
  ]);

  return (
    <>
      <SettingsPageHeader
        title="Online store"
        description="A web page with your menu that customers open from a QR or a WhatsApp link."
      />
      <div className="space-y-4">
        <SettingsCard title="Store name">
          <StoreNameClient initialName={vendor.name} isOwner={isOwner} />
        </SettingsCard>
        <SettingsCard title="Store link" description="The web address of your store page, for your Instagram bio.">
          <StoreHandleClient
            initialHandle={vendor.slug}
            isOwner={isOwner}
            published={settings?.publishStorefront ?? false}
          />
        </SettingsCard>
        <SettingsCard title="Store type & location" description="The line under your store name on your store page.">
          <StoreDetailsClient
            initialStallType={vendor.stallType}
            initialStallTypeOther={vendor.stallTypeOther}
            initialCity={vendor.city}
            initialState={vendor.state}
            isOwner={isOwner}
          />
        </SettingsCard>
        <SettingsCard title="Banner & logo" description="Shown at the top of your store page.">
          <StoreImagesClient
            storeName={vendor.name}
            initialBannerUrl={vendor.bannerUrl}
            initialLogoUrl={vendor.logoUrl}
            isOwner={isOwner}
          />
        </SettingsCard>
        <SettingsCard title="Your store page">
          <StorefrontClient
            slug={vendor.slug}
            initialPublished={settings?.publishStorefront ?? false}
            hasUpiId={Boolean(vendor.upiId)}
            availableItemCount={availableItemCount}
          />
        </SettingsCard>
        <SettingsCard title="Instagram" description="Shown on your store page as a link to your profile.">
          <InstagramHandleClient initialHandle={settings?.instagramHandle ?? null} isOwner={isOwner} />
        </SettingsCard>
        <SettingsCard title="Food licence" description="Shown on your store page.">
          <FssaiNumberClient initialFssaiNumber={settings?.fssaiNumber ?? null} />
        </SettingsCard>
      </div>
    </>
  );
}
