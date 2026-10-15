import { Bike } from "lucide-react";

/** 404 for a rider link (still served with a 404 status): unknown token or inactive seller, one message. */
export default function RiderLinkNotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-16 text-center"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground">
        <Bike className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold text-foreground">This delivery link isn&apos;t available</h1>
      <p className="mt-2 text-sm text-muted-foreground">Check the link in the message the seller sent you.</p>
    </main>
  );
}
