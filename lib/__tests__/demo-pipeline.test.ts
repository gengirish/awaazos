import { describe, expect, it } from "vitest";

import {
  fillTemplate,
  findDuplicates,
  isGoingQuiet,
  isOrdersWaiting,
  looksLikeTestStore,
  needsClaimLink,
  pipelineState,
  pipelineTile,
  priorityScore,
  queueReason,
  sortQueue,
  templateKindFor,
  type PipelineFacts,
} from "@/lib/demo-pipeline";
import { outreachTemplate, outreachWhatsappUrl } from "@/lib/outreach-message";

const NOW = new Date("2026-11-05T06:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function facts(over: Partial<PipelineFacts> = {}): PipelineFacts {
  return {
    isDemo: true,
    createdAt: daysAgo(1),
    claimedAt: null,
    inviteSentAt: null,
    lastNudgeAt: null,
    nudgeCount: 0,
    snoozedUntil: null,
    archivedAt: null,
    archivedReason: null,
    restoredAt: null,
    orderCount: 0,
    lastOrderAt: null,
    dropsThisWeek: 0,
    ...over,
  };
}

describe("priority", () => {
  const ordersWaiting = facts({ orderCount: 1, lastOrderAt: daysAgo(0), createdAt: daysAgo(10) });
  const followUp = facts({ inviteSentAt: daysAgo(3), createdAt: daysAgo(4) });
  const fresh = facts({ createdAt: daysAgo(0) });

  it("orders waiting outranks a due follow-up, which outranks a fresh build", () => {
    const a = priorityScore(ordersWaiting, NOW)!;
    const b = priorityScore(followUp, NOW)!;
    const c = priorityScore(fresh, NOW)!;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    const sorted = sortQueue(
      [{ id: "fresh", facts: fresh }, { id: "orders", facts: ordersWaiting }, { id: "follow", facts: followUp }],
      NOW,
    );
    expect(sorted.map((s) => s.id)).toEqual(["orders", "follow", "fresh"]);
  });

  it("a fresh build loses a point a day, so newest comes first", () => {
    expect(priorityScore(facts({ createdAt: daysAgo(0) }), NOW)).toBe(40);
    expect(priorityScore(facts({ createdAt: daysAgo(3) }), NOW)).toBe(37);
  });

  it("excludes snoozed and archived stores, and ones waiting on the seller", () => {
    expect(priorityScore(facts({ snoozedUntil: daysAgo(-1), orderCount: 1, lastOrderAt: daysAgo(0) }), NOW)).toBeNull();
    expect(priorityScore(facts({ archivedAt: daysAgo(0), orderCount: 1, lastOrderAt: daysAgo(0) }), NOW)).toBeNull();
    expect(priorityScore(facts({ inviteSentAt: daysAgo(1) }), NOW)).toBeNull();
  });

  it("a snooze that has ended puts the store back", () => {
    expect(priorityScore(facts({ snoozedUntil: daysAgo(1) }), NOW)).not.toBeNull();
  });

  it("Send clears orders waiting until a newer order comes in", () => {
    const pitched = facts({ orderCount: 1, lastOrderAt: daysAgo(1), inviteSentAt: daysAgo(0) });
    expect(isOrdersWaiting(pitched)).toBe(false);
    expect(priorityScore(pitched, NOW)).toBeNull();
    expect(isOrdersWaiting({ ...pitched, lastOrderAt: new Date(NOW.getTime() + 1000) })).toBe(true);
  });

  it("says why a store is in the queue", () => {
    expect(queueReason(ordersWaiting, NOW)).toBe("Has 1 order");
    expect(queueReason(facts({ orderCount: 2, lastOrderAt: daysAgo(0) }), NOW)).toBe("Has 2 orders");
    expect(queueReason(followUp, NOW)).toBe("Follow-up 1 due");
    expect(queueReason(facts({ createdAt: daysAgo(3) }), NOW)).toBe("Built 3 days ago");
    expect(queueReason(fresh, NOW)).toBe("Built today");
  });
});

describe("follow-up sequence", () => {
  it("waits two days, then follow-up 1 stays due until it is sent", () => {
    const sent = facts({ inviteSentAt: daysAgo(1) });
    expect(pipelineState(sent, NOW).status).toBe("invite_sent");
    expect(pipelineState(sent, NOW).followUpDue).toBeNull();
    const due = pipelineState(facts({ inviteSentAt: daysAgo(30) }), NOW);
    expect(due.status).toBe("followup_1");
    expect(due.followUpDue).toBe(1);
  });

  it("goes on to follow-up 2 three days after the first nudge", () => {
    const nudged = { inviteSentAt: daysAgo(10), nudgeCount: 1 };
    expect(pipelineState(facts({ ...nudged, lastNudgeAt: daysAgo(2) }), NOW)).toMatchObject({
      status: "followup_1",
      followUpDue: null,
    });
    expect(pipelineState(facts({ ...nudged, lastNudgeAt: daysAgo(3) }), NOW)).toMatchObject({
      status: "followup_2",
      followUpDue: 2,
    });
  });

  it("expires five days after the second nudge, and no follow-up is due then", () => {
    const nudged = { inviteSentAt: daysAgo(20), nudgeCount: 2 };
    expect(pipelineState(facts({ ...nudged, lastNudgeAt: daysAgo(4) }), NOW).status).toBe("followup_2");
    const expired = pipelineState(facts({ ...nudged, lastNudgeAt: daysAgo(5) }), NOW);
    expect(expired.status).toBe("expired");
    expect(expired.followUpDue).toBeNull();
    expect(priorityScore(facts({ ...nudged, lastNudgeAt: daysAgo(5) }), NOW)).toBeNull();
  });

  it("a claim stops the sequence, whatever the dates say", () => {
    const claimed = facts({ isDemo: false, claimedAt: daysAgo(1), inviteSentAt: daysAgo(30), dropsThisWeek: 1 });
    expect(pipelineState(claimed, NOW)).toMatchObject({ status: "claimed", followUpDue: null, nextActionAt: null });
    expect(priorityScore(claimed, NOW)).toBeNull();
  });

  it("every status but archived has a tile; follow-ups count as sent", () => {
    expect(pipelineTile("invite_sent")).toBe("sent");
    expect(pipelineTile("followup_2")).toBe("sent");
    expect(pipelineTile("archived")).toBeNull();
  });
});

describe("stale", () => {
  it("an unsent store with no orders reads as archived at 21 days, with no write", () => {
    expect(pipelineState(facts({ createdAt: daysAgo(20) }), NOW).status).toBe("built");
    expect(pipelineState(facts({ createdAt: daysAgo(21) }), NOW)).toMatchObject({
      status: "archived",
      archivedReason: "stale",
    });
  });

  it("orders, a send or a restore keep it out", () => {
    const old = daysAgo(40);
    expect(pipelineState(facts({ createdAt: old, orderCount: 1, lastOrderAt: daysAgo(30) }), NOW).status).toBe("built");
    expect(pipelineState(facts({ createdAt: old, inviteSentAt: daysAgo(1) }), NOW).status).toBe("invite_sent");
    expect(pipelineState(facts({ createdAt: old, restoredAt: daysAgo(1) }), NOW).status).toBe("built");
  });
});

describe("going quiet", () => {
  const claimed = facts({ isDemo: false, claimedAt: daysAgo(30) });

  it("needs no drop and no recent order", () => {
    expect(isGoingQuiet(claimed, NOW)).toBe(true);
    expect(isGoingQuiet({ ...claimed, dropsThisWeek: 1 }, NOW)).toBe(false);
    expect(isGoingQuiet({ ...claimed, lastOrderAt: daysAgo(3) }, NOW)).toBe(false);
    expect(isGoingQuiet({ ...claimed, lastOrderAt: daysAgo(14) }, NOW)).toBe(true);
  });

  it("gives a new owner their first week, and a nudged one a week to answer", () => {
    expect(isGoingQuiet({ ...claimed, claimedAt: daysAgo(3) }, NOW)).toBe(false);
    expect(isGoingQuiet({ ...claimed, lastNudgeAt: daysAgo(2) }, NOW)).toBe(false);
  });

  it("never applies to an unclaimed store", () => {
    expect(isGoingQuiet(facts(), NOW)).toBe(false);
  });
});

describe("hygiene", () => {
  const store = (id: string, over: Partial<Parameters<typeof findDuplicates>[0][number]> = {}) => ({
    id,
    name: "Store " + id,
    area: null,
    phone: null,
    instagram: null,
    ...over,
  });

  it("flags Cake Bake Hubli twice, whatever the punctuation", () => {
    const dups = findDuplicates([
      store("a", { name: "Cake Bake Hubli", area: "Hubli" }),
      store("b", { name: "cake-bake  hubli!", area: "hubli" }),
      store("c", { name: "Other Cakes", area: "Hubli" }),
    ]);
    expect(dups.get("a")).toEqual(["b"]);
    expect(dups.get("b")).toEqual(["a"]);
    expect(dups.has("c")).toBe(false);
  });

  it("same name in different areas is not a duplicate; a missing area still raises the chip", () => {
    expect(
      findDuplicates([store("a", { name: "Sweet Tooth", area: "Hubli" }), store("b", { name: "Sweet Tooth", area: "Pune" })])
        .size,
    ).toBe(0);
    expect(
      findDuplicates([store("a", { name: "Sweet Tooth", area: "Hubli" }), store("b", { name: "Sweet Tooth" })]).size,
    ).toBe(2);
  });

  it("matches the same phone or handle under different names, ignoring empties", () => {
    expect(findDuplicates([store("a", { phone: "+919876543210" }), store("b", { phone: "+919876543210" })]).size).toBe(2);
    expect(findDuplicates([store("a", { instagram: "CakeBake" }), store("b", { instagram: "cakebake" })]).size).toBe(2);
    expect(findDuplicates([store("a", { phone: "" }), store("b", { phone: "" })]).size).toBe(0);
  });

  it("flags asd and short or test-like names, not real ones", () => {
    for (const name of ["asd", "ASD bakery", "Test store", "qwerty", "Demo", "a!b"]) {
      expect(looksLikeTestStore(name), name).toBe(true);
    }
    for (const name of ["Cake Bake Hubli", "Prankie's Bakery"]) expect(looksLikeTestStore(name), name).toBe(false);
  });
});

describe("messages", () => {
  const vars = { firstName: "Lahari Pruthvi", storeName: "Cake Bake", storeUrl: "https://x.test/s/cb", area: "Hubli" };

  it("fills every token and keeps {claimUrl} until the link exists", () => {
    const text = fillTemplate("Hi {firstName}, {storeName} in {area}: {storeUrl} {claimUrl}", vars);
    expect(text).toBe("Hi Lahari, Cake Bake in Hubli: https://x.test/s/cb {claimUrl}");
    expect(needsClaimLink(text)).toBe(true);
    expect(fillTemplate("{claimUrl}", { ...vars, claimUrl: "https://x.test/claim/t" })).toBe("https://x.test/claim/t");
  });

  it("an empty first name leaves a clean greeting", () => {
    expect(fillTemplate("Hi {firstName}, hello", { ...vars, firstName: null })).toBe("Hi, hello");
  });

  it("asks for a claim link only when told an email is saved", () => {
    for (const kind of ["intro", "followup_1", "followup_2", "orders_waiting"] as const) {
      expect(needsClaimLink(outreachTemplate(kind, {})), kind).toBe(false);
      expect(needsClaimLink(outreachTemplate(kind, { withClaimLink: true })), kind).toBe(true);
    }
    expect(outreachTemplate("orders_waiting", {})).toContain("Send me your email");
  });

  it("picks the template for the moment", () => {
    expect(templateKindFor(facts(), NOW)).toBe("intro");
    expect(templateKindFor(facts({ inviteSentAt: daysAgo(3) }), NOW)).toBe("followup_1");
    expect(templateKindFor(facts({ inviteSentAt: daysAgo(9), nudgeCount: 1, lastNudgeAt: daysAgo(4) }), NOW)).toBe("followup_2");
    expect(templateKindFor(facts({ orderCount: 1, lastOrderAt: daysAgo(0) }), NOW)).toBe("orders_waiting");
    expect(templateKindFor(facts({ isDemo: false }), NOW)).toBe("going_quiet");
  });

  it("encodes the text and normalises the phone in the wa.me link", () => {
    expect(outreachWhatsappUrl("Hi & bye?\nhttps://x.test/s/a b", "+91 98765 43210")).toBe(
      "https://wa.me/919876543210?text=Hi%20%26%20bye%3F%0Ahttps%3A%2F%2Fx.test%2Fs%2Fa%20b",
    );
    expect(outreachWhatsappUrl("Hi", "9876543210")).toBe("https://wa.me/919876543210?text=Hi");
    expect(outreachWhatsappUrl("Hi", null)).toBe("https://wa.me/?text=Hi");
    expect(outreachWhatsappUrl("Hi", "123")).toBeNull();
  });
});
