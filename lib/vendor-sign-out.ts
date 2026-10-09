/**
 * Copy for the vendor sign-out warning (components/auth/VendorSignOutButton.tsx).
 *
 * Pure and browser-free so it is unit tested in node. The server action that
 * actually ends the session lives in app/(vendor)/actions/sign-out.ts.
 */

export const PENDING_SALES_TITLE = "Sales waiting to sync";

/** "1 sale" / "3 sales". */
export function salesCountLabel(count: number): string {
  return `${count} ${count === 1 ? "sale" : "sales"}`;
}

/** Body of the confirm dialog shown when this device still holds unsynced sales. */
export function pendingSalesMessage(count: number, storeName?: string | null): string {
  const store = storeName?.trim() || "this store";
  const one = count === 1;
  return (
    `${salesCountLabel(count)} from this device ${one ? "hasn't" : "haven't"} synced yet. ` +
    `${one ? "It'll" : "They'll"} stay saved on this device and sync the next time someone signs in to ${store} here. ` +
    `To be safe, go online and let ${one ? "it" : "them"} sync before signing out.`
  );
}
