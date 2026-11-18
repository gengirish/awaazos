import { formatINRCompact } from "@/lib/currency";
import { deliveryAreaSummary, type DeliveryArea } from "@/lib/delivery-areas";

/**
 * The short "how you get it" lines in an item's detail sheet on /s/[slug]
 * (components/storefront/ItemDetailSheet.tsx): when, by when to order, where
 * to pick up, where it is delivered, how to pay. The store-page header and a
 * pre-order's card already say these things; the sheet repeats only what
 * applies to the item in front of the buyer, so they need not scroll back.
 *
 * Pure and client-safe. The page formats dates and times on the server and
 * passes the finished strings in, so this file holds only the choice of lines.
 */
export type DetailFactKind = "when" | "deadline" | "pickup" | "delivery" | "payment";
export type DetailFact = { kind: DetailFactKind; text: string };

/** "Free delivery in Kondapur · ₹40 delivery in Gachibowli", else the one fee. */
export function deliveryFactText(areas: readonly DeliveryArea[], feePaise: number): string {
  return (
    deliveryAreaSummary(areas, feePaise) ??
    (feePaise > 0 ? `Delivery · ${formatINRCompact(feePaise)} fee` : "Free delivery")
  );
}

function push(facts: DetailFact[], kind: DetailFactKind, text: string | null | undefined) {
  const t = text?.trim();
  if (t) facts.push({ kind, text: t });
}

/** An everyday-menu item: pickup and/or delivery, the next slot when the store has slots, payment. */
export function menuDetailFacts(input: {
  pickup: boolean;
  delivery: boolean;
  pickupNote: string | null;
  deliveryAreas: readonly DeliveryArea[];
  deliveryFeePaise: number;
  /** "Tomorrow · 12–2 pm"; null when the store has no slots. */
  nextSlotLabel: string | null;
  paymentText: string | null;
}): DetailFact[] {
  const facts: DetailFact[] = [];
  push(facts, "when", input.nextSlotLabel ? `Next slot: ${input.nextSlotLabel}` : null);
  if (input.pickup) push(facts, "pickup", input.pickupNote?.trim() ? `Pickup: ${input.pickupNote.trim()}` : "Pickup");
  if (input.delivery) push(facts, "delivery", deliveryFactText(input.deliveryAreas, input.deliveryFeePaise));
  push(facts, "payment", input.paymentText);
  return facts;
}

/**
 * A pre-order item: its handover window ("Pickup · Today · 5–9 pm", which
 * already names pickup or delivery), the cut-off while it takes orders, the
 * pickup place, the delivery terms, payment.
 */
export function dropDetailFacts(input: {
  /** "Delivery or pickup · Sat · 5–9 pm". */
  handoverText: string;
  /** "Order by today, 4 pm"; null once it no longer takes orders. */
  deadlineText: string | null;
  delivery: boolean;
  pickupNote: string | null;
  deliveryAreas: readonly DeliveryArea[];
  deliveryFeePaise: number;
  paymentText: string | null;
}): DetailFact[] {
  const facts: DetailFact[] = [];
  push(facts, "when", input.handoverText);
  push(facts, "deadline", input.deadlineText);
  push(facts, "pickup", input.pickupNote?.trim() ? `Pickup: ${input.pickupNote.trim()}` : null);
  if (input.delivery) push(facts, "delivery", deliveryFactText(input.deliveryAreas, input.deliveryFeePaise));
  push(facts, "payment", input.paymentText);
  return facts;
}
