import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { settingsSection } from "@/components/settings/sections";
import { OwnerSurveyForm } from "@/components/survey/OwnerSurveyForm";
import { loadSurveyAnswers } from "@/lib/owner-survey-server";

import { requireSettingsContext } from "../_context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tell us what's hard · Settings · AwaazOS" };

/** Settings → Tell us what's hard (OWNER of a real store). Rules in lib/owner-survey.ts. */
export default async function SurveySettingsPage() {
  const { vendor, isOwner } = await requireSettingsContext();
  if (!isOwner || vendor.isDemo) redirect("/settings");

  const section = settingsSection("survey");
  const answers = await loadSurveyAnswers(vendor.id);

  return (
    <>
      <SettingsPageHeader title={section.title} description={section.description} />
      <SettingsCard title="A few quick questions">
        <OwnerSurveyForm answers={answers} />
      </SettingsCard>
    </>
  );
}
