"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useStoreHandleCheck, type StoreHandleCheck } from "@/hooks/useStoreHandleCheck";
import {
  normaliseStoreHandle,
  STORE_HANDLE_MAX,
  STORE_HANDLE_TAKEN_MESSAGE,
  storeHandleProblem,
  storeHandleWhileTyping,
  storeLinkPrefix,
} from "@/lib/store-handle";

/**
 * Change the store link (`Vendor.slug`, the handle in /s/<handle>). OWNER only.
 *
 * The old link dies the moment this saves: an Instagram bio, a printed QR or a
 * buyer's order page that carries it stops working. So the save goes through a
 * ConfirmDialog that says exactly that, worded harder once the store is public.
 */
export type StoreHandleClientProps = {
  initialHandle: string;
  isOwner: boolean;
  published: boolean;
};

function hintFor(check: StoreHandleCheck, saved: boolean): string {
  switch (check.state) {
    case "checking":
      return "Checking…";
    case "available":
      return "Available.";
    case "taken":
    case "invalid":
      return check.reason;
    case "unknown":
      return "Couldn't check right now. Save to find out.";
    default:
      return saved
        ? "This is the link you share. Changing it stops the old one working."
        : "Lowercase letters, numbers and hyphens.";
  }
}

export function StoreHandleClient({ initialHandle, isOwner, published }: StoreHandleClientProps) {
  const router = useRouter();
  const [handle, setHandle] = useState(initialHandle);
  const [savedHandle, setSavedHandle] = useState(initialHandle);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [host, setHost] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setHost(window.location.host);
  }, []);

  const check = useStoreHandleCheck(handle, savedHandle);
  const dirty = handle !== savedHandle;

  function askToSave() {
    const next = normaliseStoreHandle(handle);
    setHandle(next);
    const problem = storeHandleProblem(next);
    if (problem) {
      setError(problem);
      return;
    }
    if (next === savedHandle) return;
    setError(null);
    setConfirming(true);
  }

  function save() {
    const next = handle;
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ slug: next }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            details?: Record<string, string[] | undefined>;
          };
          const message =
            data.error === "store_handle_taken"
              ? STORE_HANDLE_TAKEN_MESSAGE
              : (data.details?.slug?.[0] ?? data.error ?? "Could not save.");
          setError(message);
          toast.error(message);
          return;
        }
        setSavedHandle(next);
        toast.success("Store link saved.");
        // The "Your store page" card and the shell read the link on the server.
        router.refresh();
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  const describedBy = error ? "store-handle-hint store-handle-error" : "store-handle-hint";

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !pending && isOwner) askToSave();
      }}
    >
      {!isOwner && <p className="text-sm text-muted-foreground">Only the owner can change this.</p>}
      <label htmlFor="store-handle" className="text-sm font-medium">
        Store link
      </label>
      <div className="flex min-h-11 items-center rounded-md border border-input bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
        <span className="shrink-0 select-none pl-3 text-sm text-muted-foreground" aria-hidden="true">
          {storeLinkPrefix(host || "awaazos")}
        </span>
        <input
          id="store-handle"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={STORE_HANDLE_MAX}
          value={handle}
          disabled={!isOwner}
          onChange={(e) => {
            setHandle(storeHandleWhileTyping(e.target.value));
            setError(null);
          }}
          onBlur={() => setHandle((v) => normaliseStoreHandle(v))}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-h-11 w-full min-w-0 bg-transparent pr-3 text-base focus-visible:outline-hidden disabled:cursor-not-allowed"
        />
      </div>
      <p
        id="store-handle-hint"
        aria-live="polite"
        className={`text-xs ${
          check.state === "available"
            ? "text-success"
            : check.state === "taken" || check.state === "invalid"
              ? "text-destructive"
              : "text-muted-foreground"
        }`}
      >
        {hintFor(check, !dirty)}
      </p>
      {error ? (
        <p id="store-handle-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!isOwner || !dirty || pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending && dirty ? "Saving…" : dirty ? "Save" : "Saved"}
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Change your store link to /s/${handle}?`}
        description={
          published
            ? "Your store is live. The old link stops working right away: update your Instagram bio, and any QR code or post that carries it."
            : "The old link stops working. Anywhere you already shared it needs the new one."
        }
        confirmLabel="Change link"
        onConfirm={save}
      />
    </form>
  );
}
