import { describe, expect, it } from "vitest";

import { SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsGroupsFor, settingsSectionsFor } from "@/components/settings/sections";

function groupTitles(viewer: { isOwner: boolean; isDemo: boolean }) {
  return settingsGroupsFor(settingsSectionsFor(viewer)).map((g) => g.title);
}

describe("settingsGroupsFor", () => {
  it("shows an owner every heading, in order, and every section once", () => {
    const groups = settingsGroupsFor(settingsSectionsFor({ isOwner: true, isDemo: false }));
    expect(groups.map((g) => g.title)).toEqual([...SETTINGS_GROUPS]);
    const ids = groups.flatMap((g) => g.sections.map((s) => s.id));
    expect([...ids].sort()).toEqual(SETTINGS_SECTIONS.map((s) => s.id).sort());
  });

  it("leaves out a heading with nothing under it", () => {
    expect(groupTitles({ isOwner: false, isDemo: false })).toEqual(["Your store", "Money", "Phone & counter"]);
    expect(groupTitles({ isOwner: true, isDemo: true })).toEqual(["Your store", "Money", "Phone & counter"]);
  });
});
