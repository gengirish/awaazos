import Link from "next/link";

import { BRAND_NAME } from "@/lib/brand";

/**
 * One line under every buyer-facing store page (/s/[slug], the order page):
 * who sells, and that the software is only the ordering tool. Links the Terms'
 * "Seller responsibility" clause. A server component, no client JS.
 */
export function SoldByNotice({ storeName }: { storeName: string }) {
  return (
    <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
      Sold by {storeName}. {BRAND_NAME} provides the ordering software only.{" "}
      <Link
        href="/legal/terms"
        className="font-medium underline underline-offset-2 hover:text-foreground"
      >
        Terms
      </Link>
    </p>
  );
}
