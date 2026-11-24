import { describe, expect, it, vi } from "vitest";

// Keep Prisma/env/KV out of the unit run (same as drops.test.ts).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/drops-signal", () => ({ bumpOrderSignal: vi.fn() }));

import { CLOSED_DROP_GRACE_MS } from "@/lib/storefront-order";
import { findFocusedDrop, focusedDropVisibility, isPlausibleDropId } from "@/lib/storefront-drop";

const now = new Date("2026-11-23T10:00:00.000Z");
const hour = 60 * 60 * 1000;
const at = (ms: number) => new Date(now.getTime() + ms);

const open = { id: "open", status: "OPEN" as const, opensAt: null, closesAt: at(5 * hour) };
const later = { id: "later", status: "OPEN" as const, opensAt: at(2 * hour), closesAt: at(9 * hour) };
const justClosed = { id: "just-closed", status: "OPEN" as const, opensAt: null, closesAt: at(-hour / 2) };
const longClosed = { id: "long-closed", status: "OPEN" as const, opensAt: null, closesAt: at(-CLOSED_DROP_GRACE_MS - hour) };
const draft = { id: "draft", status: "DRAFT" as const, opensAt: null, closesAt: at(5 * hour) };
const drops = [open, later, justClosed, longClosed, draft];

describe("findFocusedDrop", () => {
  it("finds a drop the store page would list: open, starting later, or just closed", () => {
    expect(findFocusedDrop(drops, "open", now)).toBe(open);
    expect(findFocusedDrop(drops, "later", now)).toBe(later);
    expect(findFocusedDrop(drops, "just-closed", now)).toBe(justClosed);
    expect(focusedDropVisibility(justClosed, now)).toBe("closed");
  });

  it("shows the store for a drop past its grace window, a draft, or an id not among the store's drops", () => {
    expect(findFocusedDrop(drops, "long-closed", now)).toBeNull();
    expect(findFocusedDrop(drops, "draft", now)).toBeNull();
    expect(findFocusedDrop(drops, "another-stores-drop", now)).toBeNull();
    expect(findFocusedDrop(drops, "", now)).toBeNull();
    expect(findFocusedDrop(drops, undefined, now)).toBeNull();
  });

  it("refuses ids no cuid could be", () => {
    expect(isPlausibleDropId("x".repeat(64))).toBe(true);
    expect(isPlausibleDropId("x".repeat(65))).toBe(false);
    expect(findFocusedDrop([{ ...open, id: "x".repeat(65) }], "x".repeat(65), now)).toBeNull();
  });
});
