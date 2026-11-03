"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { buyerUpdateMessage, whatsappHref, type BoardOrder } from "@/lib/drops-board";

const LINK =
  "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The order card's WhatsApp button, with text for where the order is, and
 * "Ready for pickup" on a confirmed pickup. The seller reads and sends it from
 * their own WhatsApp; nothing is stamped or sent from our side.
 */
export function BuyerWhatsAppLinks({
  order,
  phone,
  vendorName,
}: {
  order: BoardOrder;
  phone: string;
  vendorName: string;
}) {
  // The app's own origin (custom domain or not) for the buyer's order link.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const orderUrl = origin && order.buyerOrderPath ? `${origin}${order.buyerOrderPath}` : null;
  const who = order.customerName ?? "customer";

  return (
    <>
      <a
        href={whatsappHref(phone, buyerUpdateMessage(order, vendorName, orderUrl))}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK}
        aria-label={`WhatsApp ${who}`}
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        WhatsApp
      </a>
      {order.fulfilmentType === "PICKUP" && order.fulfilmentStatus === "CONFIRMED" ? (
        <a
          href={whatsappHref(phone, buyerUpdateMessage(order, vendorName, orderUrl, true))}
          target="_blank"
          rel="noopener noreferrer"
          className={`${LINK} basis-full`}
          aria-label={`Tell ${who} on WhatsApp that the order is ready for pickup`}
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          Ready for pickup
        </a>
      ) : null}
    </>
  );
}
