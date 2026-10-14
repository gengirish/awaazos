import { SearchX } from "lucide-react";

/**
 * 404 for a buyer's order page (still served with a 404 status). The same
 * message whether the token is wrong or the store is gone or unpublished, and
 * no link back to a store that may not be there.
 */
export default function StorefrontOrderNotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-16 text-center"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground">
        <SearchX className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold text-foreground">This order link isn&apos;t available</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Check that you opened the full link from your order, or go back to the link in the seller&apos;s bio.
      </p>
    </main>
  );
}
