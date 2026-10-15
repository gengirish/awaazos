import { formatINR } from "@/lib/currency";
import type { DeliveryRider } from "@/lib/delivery-riders";
import { balanceDuePaise, handoverDue, whatsappHref, type BoardOrder } from "@/lib/drops-board";
import { formatIndianMobile } from "@/lib/phone";

/**
 * Text a seller pastes into Porter / Rapido or sends to their own rider for one
 * delivery order. Pure and client-safe.
 *
 * It carries the buyer's name, phone and address on purpose — that is what a
 * rider needs — so it only ever leaves the device through the seller's own tap
 * (clipboard or share sheet). Never log it or send it to a server.
 */

export type RiderHandoffOrder = Pick<
  BoardOrder,
  | "billNumber"
  | "customerName"
  | "customerPhone"
  | "deliveryAddress"
  | "notes"
  | "paymentStatus"
  | "paymentMethod"
  | "totalPaise"
  | "advancePaidPaise"
  | "items"
>;

/** What the rider should collect at the door, in words. */
export function riderCollectLine(o: RiderHandoffOrder): string {
  const due = handoverDue(o);
  if (due.kind === "paid") return "Paid — nothing to collect";
  const balance = balanceDuePaise(o);
  const amount = balance > 0 ? balance : due.amountPaise;
  return due.kind === "collect_cash"
    ? `Collect ${formatINR(amount)} cash`
    : `Not paid yet — collect ${formatINR(amount)}`;
}

export function formatRiderHandoff(o: RiderHandoffOrder, vendorName: string): string {
  const lines = [`Delivery for ${vendorName.trim()} · ${o.billNumber}`];
  lines.push(`Name: ${o.customerName?.trim() || "Customer"}`);
  if (o.customerPhone) lines.push(`Phone: ${formatIndianMobile(o.customerPhone)}`);
  const address = o.deliveryAddress?.trim();
  lines.push(address ? `Address: ${address}` : "Address: (not given — call the customer)");
  if (o.items.length > 0) lines.push(`Items: ${o.items.map((it) => `${it.qty} × ${it.name}`).join(", ")}`);
  lines.push(riderCollectLine(o));
  const notes = o.notes?.trim();
  if (notes) lines.push(`Note: ${notes}`);
  return lines.join("\n");
}

/** wa.me link that opens a chat with a saved rider (E.164 phone), `text` pre-filled. */
export function riderWhatsappUrl(rider: DeliveryRider, text: string): string {
  return whatsappHref(rider.phone, text);
}
