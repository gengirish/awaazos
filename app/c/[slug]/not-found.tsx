import { Store } from "lucide-react";

/**
 * 404 for a community page (still served with a 404 status). One message for
 * every miss; no community data is read here.
 */
export default function CommunityNotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-16 text-center"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground">
        <Store className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold text-foreground">This page isn&apos;t available</h1>
      <p className="mt-2 text-sm text-muted-foreground">Check the link you were sent.</p>
    </main>
  );
}
