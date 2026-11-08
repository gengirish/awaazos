"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Error boundary for the rider's delivery page. The thrown error is never
 * rendered or logged from here; `digest` is Next's opaque hash of a server
 * error and is safe to show.
 */
export default function RiderLinkError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-16 text-center"
    >
      <div role="alert" className="flex flex-col items-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This delivery couldn&apos;t load. Check your connection and try again.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        ) : null}
      </div>
      <Button type="button" className="mt-6 min-h-11" onClick={() => reset()}>
        <RotateCw aria-hidden="true" />
        Try again
      </Button>
    </main>
  );
}
