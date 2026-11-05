import type { Metadata } from "next";

import { CommunitiesClient } from "@/components/settings/CommunitiesClient";
import { FssaiNumberClient } from "@/components/settings/FssaiNumberClient";
import { InstagramHandleClient } from "@/components/settings/InstagramHandleClient";
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { StoreDetailsClient } from "@/components/settings/StoreDetailsClient";
import { StoreHandleClient } from "@/components/settings/StoreHandleClient";
import { StoreImagesClient } from "@/components/settings/StoreImagesClient";
import { StoreNameClient } from "@/components/settings/StoreNameClient";
import { StoreTaglineClient } from "@/components/settings/StoreTaglineClient";
import { StoreThemeClient } from "@/components/settings/StoreThemeClient";
import { StorefrontClient } from "@/components/settings/StorefrontClient";
import { listVendorCommunities } from "@/lib/community-server";
import { prisma } from "@/lib/prisma";
import { isOnlinePaymentEnabled, RAZORPAY_CRED_SELECT } from "@/lib/storefront-razorpay";

import { requireSettingsContext } from "../_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Online store · Settings · AwaazOS" };

export default async function StoreSettingsPage() {
  const { vendor, isOwner, storeKind, vocab } = await requireSettingsContext();

  const [settings, availableItemCount, communities] = await Promise.all([
    prisma.vendorSettings.findUnique({
      where: { vendorId: vendor.id },
      select: {
        publishStorefront: true,
        fssaiNumber: true,
        instagramHandle: true,
        theme: true,
        tagline: true,
        ...RAZORPAY_CRED_SELECT,
      },
    }),
    prisma.menuItem.count({ where: { vendorId: vendor.id, isAvailable: true } }),
    listVendorCommunities(vendor.id),
  ]);

  return (
    <>
      <SettingsPageHeader
        title="Online store"
        description={`A web page with your ${vocab.catalogue} that customers open from a QR or a WhatsApp link.`}
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
        <SettingsCard title="Tagline" description="One line under your store name on your store page, and under your link when it is shared.">
          <StoreTaglineClient
            initialTagline={settings?.tagline ?? null}
            isOwner={isOwner}
            example={
              storeKind === "food"
                ? "e.g. Home-style Andhra meals, cooked fresh every morning"
                : "e.g. Energised crystals and malas, made in Hyderabad"
            }
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
        <SettingsCard title="Store colour" description="Tints the buttons and links on your store page.">
          <StoreThemeClient initialTheme={settings?.theme} isOwner={isOwner} />
        </SettingsCard>
        <SettingsCard title="Your store page">
          <StorefrontClient
            slug={vendor.slug}
            initialPublished={settings?.publishStorefront ?? false}
            hasUpiId={Boolean(vendor.upiId) || isOnlinePaymentEnabled(vendor, settings)}
            availableItemCount={availableItemCount}
            catalogueTitle={vocab.catalogueTitle}
          />
        </SettingsCard>
        {communities.length > 0 ? (
          <SettingsCard
            title="Community pages"
            description={`Pages for your housing society that link to the ${storeKind === "food" ? "home kitchens" : "home sellers"} living there.`}
          >
            <CommunitiesClient
              initial={communities}
              isOwner={isOwner}
              published={settings?.publishStorefront ?? false}
            />
          </SettingsCard>
        ) : null}
        <SettingsCard title="Instagram" description="Shown on your store page as a link to your profile.">
          <InstagramHandleClient initialHandle={settings?.instagramHandle ?? null} isOwner={isOwner} />
        </SettingsCard>
        {/* Many non-food products (supplements, herbal teas) need an FSSAI licence too, so every store keeps the field. */}
        <SettingsCard
          title={storeKind === "food" ? "Food licence" : "FSSAI licence (if you have one)"}
          description="Shown on your store page."
        >
          <FssaiNumberClient initialFssaiNumber={settings?.fssaiNumber ?? null} storeKind={storeKind} />
        </SettingsCard>
      </div>
    </>
  );
}
