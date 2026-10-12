"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronRight, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

import { signOutVendor } from "@/app/(vendor)/actions/sign-out";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { listSales } from "@/lib/pos-outbox";
import { cn } from "@/lib/utils";
import { PENDING_SALES_TITLE, pendingSalesMessage } from "@/lib/vendor-sign-out";

export type VendorSignOutButtonProps = {
  /**
   * `icon`: 44×44 POS header button with a hover/focus label.
   * `header`: text button for the settings header.
   * `row`: full-width row for the settings hub.
   */
  variant: "icon" | "header" | "row";
  /** When given, warns before signing out if this device holds unsynced POS sales for the vendor. */
  vendorId?: string;
  /** Store name used in the warning ("…signs in to <store> here"). */
  storeName?: string;
  className?: string;
};

const FOCUS_RING =
  "ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** Matches the Settings gear in components/pos/PosHeader.tsx. */
const ICON_CLASS = cn(
  "group relative flex h-11 min-w-[44px] items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-70",
  FOCUS_RING,
);

const HEADER_CLASS = cn(
  "inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-70",
  FOCUS_RING,
);

const ROW_CLASS =
  "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left ring-inset transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70";

async function countPendingSales(vendorId: string): Promise<number> {
  try {
    const sales = await listSales(vendorId);
    return sales.filter((s) => s.status === "pending").length;
  } catch {
    // IndexedDB unavailable (private mode quirks): nothing we can check.
    return 0;
  }
}

async function hasSession(): Promise<boolean> {
  const res = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`session ${res.status}`);
  const data = (await res.json().catch(() => null)) as { user?: unknown } | null;
  return Boolean(data?.user);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sign out and make sure it sticks. Every request that passes through the
 * Auth.js middleware re-issues the session cookie, so a router prefetch that
 * was already in flight when the cookie was deleted can set it again when its
 * response lands. Check the session until
 * it reads as signed out twice in a row, signing out again if it came back.
 * Returns false if the server could not be reached.
 */
async function endSession(): Promise<boolean> {
  let clearChecks = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      if (clearChecks === 0) await signOutVendor();
      await sleep(250);
      if (await hasSession()) {
        clearChecks = 0;
        continue;
      }
      clearChecks++;
      if (clearChecks >= 2) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function VendorSignOutButton({ variant, vendorId, storeName, className }: VendorSignOutButtonProps) {
  const [busy, setBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);

  async function doSignOut() {
    setBusy(true);
    if (await endSession()) {
      // Full-page navigation, not router.push: it goes through the service
      // worker, which drops the cached /pos page on /sign-in, and clears state.
      window.location.assign("/sign-in");
      return;
    }
    toast.error("Couldn't sign out. Check your connection and try again.");
    setBusy(false);
    setConfirmOpen(false);
    inFlight.current = false;
  }

  async function onClick() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const pending = vendorId ? await countPendingSales(vendorId) : 0;
    if (pending > 0) {
      setPendingCount(pending);
      setConfirmOpen(true);
      setBusy(false);
      inFlight.current = false;
      return;
    }
    await doSignOut();
  }

  function onConfirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    void doSignOut();
  }

  const Icon = busy ? Loader2 : LogOut;
  const iconEl = (
    <Icon className={cn("h-5 w-5 shrink-0", busy && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
  );
  const label = busy ? "Signing out…" : "Sign out";

  let trigger: ReactNode;
  if (variant === "icon") {
    trigger = (
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        aria-busy={busy}
        aria-label={busy ? "Signing out" : "Sign out"}
        className={cn(ICON_CLASS, className)}
      >
        {iconEl}
        {/* Visible label for sighted mouse/keyboard users; the accessible name is aria-label. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        >
          {label}
        </span>
      </button>
    );
  } else if (variant === "header") {
    trigger = (
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        aria-busy={busy}
        className={cn(HEADER_CLASS, className)}
      >
        <Icon
          className={cn("h-4 w-4 shrink-0", busy && "animate-spin motion-reduce:animate-none")}
          aria-hidden="true"
        />
        {label}
      </button>
    );
  } else {
    trigger = (
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        aria-busy={busy}
        className={cn(ROW_CLASS, className)}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          {iconEl}
        </span>
        <span className="min-w-0 flex-1 font-semibold text-foreground">{label}</span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    );
  }

  return (
    <>
      {trigger}
      <ResponsiveDialog open={confirmOpen} onOpenChange={(open) => !busy && setConfirmOpen(open)}>
        <ResponsiveDialogContent
          className="md:max-w-md"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{PENDING_SALES_TITLE}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{pendingSalesMessage(pendingCount, storeName)}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              disabled={busy}
              aria-busy={busy}
              onClick={onConfirm}
            >
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {busy ? "Signing out…" : "Sign out anyway"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
