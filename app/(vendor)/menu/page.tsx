import type { MenuItem } from "@prisma/client";
import { redirect } from "next/navigation";

import { MenuScreen } from "@/components/menu/MenuScreen";
import { prisma } from "@/lib/prisma";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { storeVocabulary, type StoreVocabulary } from "@/lib/store-vocabulary";

export default async function MenuPage(props: {
  searchParams: Promise<{ add?: string | string[]; voice?: string | string[] }>;
}) {
  // `?add=<name>` (from the voice drop builder's "Add to menu") opens the add form pre-filled.
  // `?voice=1` (from onboarding's "Speak your whole menu") opens the voice panel.
  const { add, voice } = await props.searchParams;
  const prefillName = typeof add === "string" ? add.trim().slice(0, 80) : "";
  const voiceOpen = voice === "1";

  let vendorId: string;
  let vocab: StoreVocabulary;
  try {
    const ctx = await requireVendorRole("CASHIER");
    vendorId = ctx.vendor.id;
    vocab = storeVocabulary(ctx.vendor.stallType);
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/sign-in");
    }
    throw e;
  }

  const [items, settings]: [MenuItem[], { voiceLang: string } | null] = await Promise.all([
    prisma.menuItem.findMany({
      where: { vendorId },
      orderBy: { sortOrder: "asc" },
    }),
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
      />
    </div>
  );
}
