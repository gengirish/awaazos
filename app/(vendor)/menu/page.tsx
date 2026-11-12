import { redirect } from "next/navigation";

import { MenuScreen } from "@/components/menu/MenuScreen";
import { env } from "@/lib/env";
import { canSeeCost, rowsForRole } from "@/lib/item-cost";
import { withStockLeft, withVariants } from "@/lib/menu-stock-server";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { storeVocabulary, type StoreVocabulary } from "@/lib/store-vocabulary";

export default async function MenuPage(props: {
  searchParams: Promise<{ add?: string | string[]; voice?: string | string[] }>;
}) {
  // `?add=<name>` (from the voice drop builder's "Add to menu") opens the add form pre-filled.
  // `?voice=1` opens the voice panel: a link straight to it.
  const { add, voice } = await props.searchParams;
  const prefillName = typeof add === "string" ? add.trim().slice(0, 80) : "";
  const voiceOpen = voice === "1";

  let vendorId: string;
  let vocab: StoreVocabulary;
  let seesCost: boolean;
  let role: Parameters<typeof canSeeCost>[0];
  try {
    const ctx = await requireVendorRole("CASHIER");
    vendorId = ctx.vendor.id;
    vocab = storeVocabulary(ctx.vendor.stallType);
    role = ctx.staff.role;
    // Cost prices are for MANAGER and up (lib/item-cost.ts rule 2).
    seesCost = canSeeCost(role);
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/sign-in");
    }
    throw e;
  }

  const [items, settings] = await Promise.all([
    prisma.menuItem
      .findMany({
        where: { vendorId },
        orderBy: { sortOrder: "asc" },
      })
      // Stock left is derived (lib/inventory.ts); no query when nothing is tracked.
      .then((rows) => withStockLeft(prisma, vendorId, rows))
      // Sizes / colours, each with its own stock (lib/item-variants.ts).
      .then((rows) => withVariants(prisma, vendorId, rows, new Date(), { cost: seesCost }))
      .then((rows) => rowsForRole(rows, role)),
    prisma.vendorSettings.findUnique({ where: { vendorId }, select: { voiceLang: true } }),
  ]);

  return (
    <div className="bg-background p-4 pb-10 md:p-6">
      <MenuScreen
        initialItems={items}
        voiceLang={settings?.voiceLang ?? "en-IN"}
        voiceOpen={voiceOpen}
        prefillName={prefillName || undefined}
        vocab={vocab}
        sizesEnabled={env.ITEM_VARIANTS_ENABLED === "true"}
        canSeeCost={seesCost}
      />
    </div>
  );
}
