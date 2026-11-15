"use client";

import { Link2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { withInstagramTag, withWhatsAppTag } from "@/lib/order-channel";

/**
 * One product's link on the seller's menu card: "Copy link for Instagram" and
 * WhatsApp (docs/PRODUCT_PAGE_PLAN.md step 2). The link is `/s/<store>/p/<id>`,
 * which opens the store with the item's detail sheet up, tagged `?src=ig` /
 * `?src=wa` so its orders count under that channel on /admin/metrics
 * (lib/order-channel.ts). Nothing is sent from our server: the seller pastes
 * the link, or their own WhatsApp opens with the text.
 *
 * Shown only for an item shown online in a published store (MenuGrid decides).
 */
export function ItemShareRow({ storeSlug, itemId, itemName }: { storeSlug: string; itemId: string; itemName: string }) {
  const link = () => `${window.location.origin}/s/${encodeURIComponent(storeSlug)}/p/${encodeURIComponent(itemId)}`;

  async function copyForInstagram() {
    try {
      await navigator.clipboard.writeText(withInstagramTag(link()));
      toast.success("Link copied. Paste it in your Instagram post, story or bio.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  function shareOnWhatsApp() {
    const text = `${itemName}: ${withWhatsAppTag(link())}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 flex-1"
        onClick={() => void copyForInstagram()}
        aria-label={`Copy link to ${itemName} for Instagram`}
      >
        <Link2 className="mr-1 h-4 w-4" aria-hidden />
        Copy link for Instagram
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="min-h-11 min-w-11"
        onClick={shareOnWhatsApp}
        aria-label={`Share ${itemName} on WhatsApp`}
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
