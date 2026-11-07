"use client";

import { useState } from "react";

import { signOutVendor } from "@/app/(vendor)/actions/sign-out";
import { Button } from "@/components/ui/button";

/**
 * Sign out from the "owner is still setting up" screen. Not VendorSignOutButton:
 * its dialog, toasts and offline-sales check would ride along in every load of
 * the setup form, and a store that hasn't finished setup has no counter sales.
 * Full-page navigation afterwards, for the same reason as there (actions/sign-out.ts).
 */
export function SignOutLink() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className="self-start"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signOutVendor();
        } finally {
          window.location.assign("/sign-in");
        }
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
