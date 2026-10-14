import { Store } from "lucide-react";

/**
 * 404 for the public storefront (still served with a 404 status).
 *
 * One message for every miss — unknown slug, inactive vendor, storefront not
 * published — because telling them apart would confirm that a store exists
 * (see the rules at the top of page.tsx). No vendor data is read here.
 */
export default function StorefrontNotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-16 text-center"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground">
        <Store className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold text-foreground">This store isn&apos;t available</h1>
      <p className="mt-2 text-sm text-muted-foreground">Check the link in the seller&apos;s bio.</p>
    </main>
  );
}
