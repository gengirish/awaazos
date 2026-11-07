/**
 * One line that says why a drop is (or isn't) taking orders — every drop card,
 * seller or buyer, shows a reason, never a bare "Orders closed".
 *
 * Pure and client-safe. Built on `effectiveDropStatus` semantics: cut-off and
 * "opens later" are computed from the drop's times on each read, never stored.
 *
 * Telling a manual close from a cut-off: a stored CLOSED with the cut-off still
 * ahead was closed by the seller; once the cut-off has passed either way, the
 * cut-off is the reason we give (it's true, and it's what a buyer cares about).
 */
import type { DropStatus } from "@prisma/client";

import { formatIstDeadline } from "@/lib/storefront-order";

export type DropStateKind =
  | "draft"
  | "scheduled"
  | "open"
  | "sold_out"
  | "cutoff_passed"
  | "closed_by_seller"
  | "locked"
  | "done";

export type DropStateInput = {
  status: DropStatus;
  opensAt: Date | string | null;
  closesAt: Date | string;
};

export function dropStateKind(drop: DropStateInput, now: Date = new Date(), soldOut = false): DropStateKind {
  const closesAt = new Date(drop.closesAt);
  const cutoffPassed = now.getTime() >= closesAt.getTime();
  switch (drop.status) {
    case "DRAFT":
      return "draft";
    case "FROZEN":
      return "locked";
    case "FULFILLED":
      return "done";
    case "CLOSED":
      return cutoffPassed ? "cutoff_passed" : "closed_by_seller";
    case "OPEN":
      if (cutoffPassed) return "cutoff_passed";
      if (drop.opensAt && now.getTime() < new Date(drop.opensAt).getTime()) return "scheduled";
      return soldOut ? "sold_out" : "open";
  }
}

/**
 * "Opens Fri 6:00 pm", "Cut-off passed (today 9:00 pm)", "Sold out", "Closed by you".
 * `viewer: "buyer"` words a manual close for the storefront ("Closed by the store").
 */
export function dropStateLabel(
  drop: DropStateInput,
  now: Date = new Date(),
  opts: { soldOut?: boolean; viewer?: "seller" | "buyer" } = {},
): string {
  const kind = dropStateKind(drop, now, opts.soldOut ?? false);
  switch (kind) {
    case "draft":
      return drop.opensAt ? `Draft · opens ${formatIstDeadline(new Date(drop.opensAt), now)}` : "Draft · not open yet";
    case "scheduled":
      return `Opens ${formatIstDeadline(new Date(drop.opensAt as Date | string), now)}`;
    case "open":
      return "Taking orders";
    case "sold_out":
      return "Sold out";
    case "cutoff_passed":
      return `Cut-off passed (${formatIstDeadline(new Date(drop.closesAt), now)})`;
    case "closed_by_seller":
      return opts.viewer === "buyer" ? "Closed by the store" : "Closed by you";
    case "locked":
      return "Orders locked";
    case "done":
      return "Done";
  }
}

