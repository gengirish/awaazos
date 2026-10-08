"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { countStoredCarts } from "@/lib/storefront-order";

/**
 * On the buyer's order page: "you still have items in another cart here".
 * A drop's cart and the everyday menu's are separate orders, so after placing
 * one the buyer may have left the other behind. Reads this device's saved
 * carts (ids + quantities only) after mount; renders nothing when there are
 * none or storage is unavailable.
 */
export function OtherCartsNotice({ slug, vendorName }: { slug: string; vendorName: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    try {
      const entries: [string, string | null][] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) entries.push([key, window.localStorage.getItem(key)]);
      }
      setCount(countStoredCarts(entries, slug, Date.now()));
    } catch {
      /* storage blocked — nothing to point at */
    }
  }, [slug]);

  if (count === 0) return null;
  return (
    <Link
      href={`/s/${encodeURIComponent(slug)}`}
      className="flex min-h-12 items-center gap-3 rounded-2xl border border-primary/30 bg-primary/6 px-4 py-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <ShoppingBag className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1">
        You still have items in {count === 1 ? "another cart" : `${count} other carts`} at {vendorName}.
      </span>
      <span className="shrink-0 font-bold text-primary">Back to store →</span>
    </Link>
  );
}
