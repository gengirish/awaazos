"use client";

import { ExternalLink } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { VendorCommunity } from "@/lib/community";

/**
 * Community pages that invited or list this store (lib/community.ts). The
 * owner accepts to be listed, declines, or leaves later — all through
 * /api/vendor/communities/[id]. Others see the list read-only.
 */
export function CommunitiesClient({
  initial,
  isOwner,
  published,
}: {
  initial: VendorCommunity[];
  isOwner: boolean;
  published: boolean;
}) {
  const [communities, setCommunities] = useState(initial);
  const [leaving, setLeaving] = useState<VendorCommunity | null>(null);
  const [pending, startTransition] = useTransition();

  function act(c: VendorCommunity, method: "POST" | "DELETE") {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/vendor/communities/${encodeURIComponent(c.id)}`, {
          method,
          credentials: "include",
        });
        if (!res.ok) {
          toast.error(res.status === 404 ? "That page no longer lists you. Reload." : "Could not save. Try again.");
          return;
        }
        if (method === "POST") {
          setCommunities((list) => list.map((x) => (x.id === c.id ? { ...x, accepted: true } : x)));
          toast.success(`Your store is now on ${c.name}.`);
        } else {
          setCommunities((list) => list.filter((x) => x.id !== c.id));
          toast.success(c.accepted ? `Your store is off ${c.name}.` : "Invite declined.");
        }
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  if (communities.length === 0) {
    return <p className="text-sm text-muted-foreground">Your store is not on any community page.</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {communities.map((c) => (
          <li key={c.id} className="rounded-md border p-3">
            <p className="font-semibold text-foreground">{c.name}</p>
            {c.area ? <p className="text-xs text-muted-foreground">{c.area}</p> : null}
            {c.accepted ? (
              <>
                <p className="mt-1 text-sm text-foreground">
                  {published
                    ? "Your store is listed on this page."
                    : "You joined, but the page shows your store only while your store page is published."}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <a
                    href={`/c/${encodeURIComponent(c.slug)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline underline-offset-4"
                  >
                    Open the page
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  {isOwner ? (
                    <Button type="button" variant="outline" disabled={pending} onClick={() => setLeaving(c)}>
                      Leave
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-foreground">
                  Wants to list your store: your name, logo, store type and city, and a link to your store page.
                  Customers still order and pay on your own page.
                </p>
                {isOwner ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" disabled={pending} onClick={() => act(c, "POST")}>
                      Join
                    </Button>
                    <Button type="button" variant="outline" disabled={pending} onClick={() => act(c, "DELETE")}>
                      No thanks
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {!isOwner ? <p className="text-xs text-muted-foreground">Only the owner can change this.</p> : null}

      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title={`Leave ${leaving?.name ?? "this page"}?`}
        description="Your store comes off the page at once. You would need a new invite to join again."
        confirmLabel="Leave"
        onConfirm={() => {
          if (leaving) act(leaving, "DELETE");
        }}
      />
    </div>
  );
}
