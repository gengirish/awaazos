import type { Metadata } from "next";

import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { VoiceLanguageClient } from "@/components/settings/VoiceLanguageClient";
import { prisma } from "@/lib/prisma";

import { requireSettingsContext } from "../_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Counter & voice · Settings · AwaazOS" };

export default async function VoiceSettingsPage() {
  const { vendor } = await requireSettingsContext();

  const settings = await prisma.vendorSettings.findUnique({
    where: { vendorId: vendor.id },
    select: { voiceLang: true },
  });

  return (
    <>
      <SettingsPageHeader title="Counter & voice" description="How the POS counter listens to your staff." />
      <SettingsCard
        title="Voice language"
        description="Pick the language your counter staff will speak when using the POS mic."
      >
        <VoiceLanguageClient initialVoiceLang={settings?.voiceLang ?? "en-IN"} />
      </SettingsCard>
    </>
  );
}
