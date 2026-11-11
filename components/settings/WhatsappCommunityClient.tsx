"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { normaliseWhatsappCommunityUrl, WHATSAPP_COMMUNITY_MESSAGE } from "@/lib/whatsapp-community";

/** The seller's own WhatsApp group or channel link, shown on the store and order pages. Saving it publishes it. */
export type WhatsappCommunityClientProps = {
  initialUrl: string | null;
  isOwner: boolean;
};

export function WhatsappCommunityClient({ initialUrl, isOwner }: WhatsappCommunityClientProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [saved, setSaved] = useState(initialUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const normalised = normaliseWhatsappCommunityUrl(url);
  const dirty = normalised !== saved;
  const disabled = !isOwner || pending;

  function save() {
    if (normalised === null) {
      setError(WHATSAPP_COMMUNITY_MESSAGE);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ whatsappCommunityUrl: normalised }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            details?: Record<string, string[] | undefined>;
          };
          const fieldMsg = data.details?.whatsappCommunityUrl?.[0];
          if (fieldMsg) setError(fieldMsg);
          toast.error(fieldMsg ?? data.error ?? "Could not save.");
          return;
        }
        setSaved(normalised);
        setUrl(normalised);
        toast.success(normalised ? "WhatsApp link saved." : "WhatsApp link removed.");
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <label htmlFor="whatsapp-community-url" className="text-sm font-medium">
        Group or channel link <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <input
        id="whatsapp-community-url"
        type="url"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={300}
        placeholder="https://chat.whatsapp.com/…"
        value={url}
        disabled={disabled}
        onChange={(e) => {
          setUrl(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby="whatsapp-community-hint"
        className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p
        id="whatsapp-community-hint"
        aria-live="polite"
        className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
      >
        {error ??
          "In WhatsApp, open your group → Invite via link → Copy link, or your channel → Share → Copy link. Anyone who opens your store can join."}
      </p>
      <button
        type="button"
        onClick={save}
        disabled={!dirty || disabled}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending && dirty ? "Saving…" : dirty ? "Save" : "Saved"}
      </button>
      {!isOwner ? <p className="text-xs text-muted-foreground">Only the owner can change this.</p> : null}
    </div>
  );
}
