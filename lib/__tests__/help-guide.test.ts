import { describe, expect, it } from "vitest";

import { SETTINGS_SECTIONS } from "@/components/settings/sections";
import { APP_NAV_ITEMS, appNavItemsForRole } from "@/lib/app-nav";
import {
  HELP_GROUPS,
  HELP_SCREEN_SUMMARY,
  HELP_TOPICS,
  helpTopicsForRole,
  matchesHelpQuery,
} from "@/lib/help-guide";

describe("help content", () => {
  it("describes every destination of the shell", () => {
    for (const item of APP_NAV_ITEMS) {
      expect(HELP_SCREEN_SUMMARY[item.id], item.id).toBeTruthy();
    }
  });

  it("has unique topic ids, each in a known group", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(HELP_GROUPS.map((g) => g.id));
    for (const topic of HELP_TOPICS) expect(groups.has(topic.group), topic.id).toBe(true);
  });

  it("links every topic to its own destination or a page under it", () => {
    for (const topic of helpTopicsForRole("OWNER")) {
      const base = APP_NAV_ITEMS.find((i) => i.id === topic.nav)!.href;
      expect(topic.href === base || topic.href.startsWith(`${base}/`), topic.id).toBe(true);
    }
  });

  it("names a Settings section exactly as Settings does", () => {
    const settingsTopics = HELP_TOPICS.filter((t) => t.href?.startsWith("/settings/"));
    expect(settingsTopics.length).toBeGreaterThan(0);
    for (const topic of settingsTopics) {
      const section = SETTINGS_SECTIONS.find((s) => s.href === topic.href);
      expect(section, topic.id).toBeDefined();
      expect(topic.trail, topic.id).toEqual([section!.title]);
    }
  });

  it("covers every Settings section", () => {
    const linked = new Set(HELP_TOPICS.map((t) => t.href));
    for (const section of SETTINGS_SECTIONS) expect(linked.has(section.href), section.id).toBe(true);
  });
});

describe("helpTopicsForRole", () => {
  it("shows an owner every topic, none of them locked", () => {
    const topics = helpTopicsForRole("OWNER");
    expect(topics).toHaveLength(HELP_TOPICS.length);
    expect(topics.some((t) => t.ownerLocked)).toBe(false);
  });

  it("never points a cashier at a screen their navigation hides", () => {
    const visible = new Set(appNavItemsForRole("CASHIER").map((i) => i.id));
    const topics = helpTopicsForRole("CASHIER");
    expect(topics.length).toBeGreaterThan(0);
    for (const topic of topics) expect(visible.has(topic.nav), topic.id).toBe(true);
    expect(topics.map((t) => t.id)).not.toContain("new-drop");
    expect(topics.map((t) => t.id)).not.toContain("export-csv");
  });

  it("marks owner-only settings as locked for a manager and a cashier, but not device alerts", () => {
    for (const role of ["MANAGER", "CASHIER"] as const) {
      const byId = new Map(helpTopicsForRole(role).map((t) => [t.id, t]));
      expect(byId.get("payment-setup")!.ownerLocked).toBe(true);
      expect(byId.get("order-alerts")!.ownerLocked).toBe(false);
    }
  });

  it("builds the path from the destination label and flags what sits behind More on a phone", () => {
    const byId = new Map(helpTopicsForRole("OWNER").map((t) => [t.id, t]));
    expect(byId.get("payment-setup")).toMatchObject({
      href: "/settings/payments",
      path: ["Settings", "Payments"],
      behindMore: true,
    });
    expect(byId.get("ring-up-sale")).toMatchObject({ href: "/pos", path: ["Sell"], behindMore: false });
    expect(byId.get("new-drop")).toMatchObject({ href: "/drops/new", path: ["Drops", "New drop"] });
  });
});

describe("matchesHelpQuery", () => {
  const topics = helpTopicsForRole("OWNER");
  const ids = (query: string) => topics.filter((t) => matchesHelpQuery(t, query)).map((t) => t.id);

  it("matches everything for an empty or blank query", () => {
    expect(ids("")).toHaveLength(topics.length);
    expect(ids("   ")).toHaveLength(topics.length);
  });

  it("ignores case and searches title, steps, path and keywords", () => {
    expect(ids("UPI")).toContain("payment-setup");
    expect(ids("gpay")).toContain("payment-setup");
    expect(ids("prep sheet")).toContain("prep-sheet");
    expect(ids("payments")).toContain("payment-setup");
  });

  it("needs every word to match", () => {
    expect(ids("receipt whatsapp")).toEqual(expect.arrayContaining(["send-receipt", "resend-receipt"]));
    expect(ids("receipt zebra")).toEqual([]);
  });
});
