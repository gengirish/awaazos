"use client";

import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { downscaleImage, type DownscaleOptions } from "@/lib/image-downscale";
import { cn } from "@/lib/utils";

/**
 * Banner and logo for the store page (`Vendor.bannerUrl` / `logoUrl`), via
 * POST/DELETE /api/vendor/banner and /api/vendor/logo. Photos are shrunk in
 * the browser first (lib/image-downscale.ts); the server re-validates.
 */
export type StoreImagesClientProps = {
  storeName: string;
  initialBannerUrl: string | null;
  initialLogoUrl: string | null;
  isOwner: boolean;
};

type Kind = "banner" | "logo";

const SPEC: Record<Kind, { label: string; hint: string; downscale: DownscaleOptions }> = {
  banner: {
    label: "Banner",
    hint: "A wide photo across the top of your store page. Landscape works best; the middle stays visible on phones.",
    downscale: { maxWidth: 1600, maxHeight: 1600, type: "image/jpeg", quality: 0.85 },
  },
  logo: {
    label: "Logo",
    hint: "A square picture next to your store name. Without one, customers see the first letter of the name.",
    // PNG keeps a transparent background; at 512 px it stays small.
    downscale: { maxWidth: 512, maxHeight: 512, type: "image/png" },
  },
};

const ACCEPT = "image/jpeg,image/png,image/webp";

const btn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium ring-offset-background transition-opacity focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function ImageField({
  kind,
  storeName,
  initialUrl,
  isOwner,
}: {
  kind: Kind;
  storeName: string;
  initialUrl: string | null;
  isOwner: boolean;
}) {
  const router = useRouter();
  const spec = SPEC[kind];
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [status, setStatus] = useState("");

  async function upload(picked: File) {
    setBusy("upload");
    setStatus(`Uploading ${spec.label.toLowerCase()}…`);
    try {
      const file = await downscaleImage(picked, spec.downscale);
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/vendor/${kind}`, { method: "POST", body, credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as { data?: { url: string }; error?: string };
      if (!res.ok || !data.data) {
        const msg = data.error ?? "Could not upload.";
        setStatus(msg);
        toast.error(msg);
        return;
      }
      setUrl(data.data.url);
      setStatus(`${spec.label} saved.`);
      toast.success(`${spec.label} saved.`);
      router.refresh();
    } catch {
      setStatus("Network error — please try again.");
      toast.error("Network error — please try again.");
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy("remove");
    setStatus("");
    try {
      const res = await fetch(`/api/vendor/${kind}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = data.error ?? "Could not remove.";
        setStatus(msg);
        toast.error(msg);
        return;
      }
      setUrl(null);
      setStatus(`${spec.label} removed.`);
      toast.success(`${spec.label} removed.`);
      router.refresh();
    } catch {
      setStatus("Network error — please try again.");
      toast.error("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{spec.label}</p>

      {kind === "banner" ? (
        <div className="relative aspect-[8/3] w-full overflow-hidden rounded-lg border bg-linear-to-b from-primary/20 to-background">
          {url ? (
            <Image src={url} alt={`Current banner for ${storeName}`} fill sizes="(min-width: 640px) 600px, 100vw" className="object-cover" />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">No banner yet</p>
          )}
        </div>
      ) : url ? (
        <Image
          src={url}
          alt={`Current logo for ${storeName}`}
          width={88}
          height={88}
          className="h-[88px] w-[88px] rounded-2xl border bg-background object-cover"
        />
      ) : (
        <div
          role="img"
          aria-label="No logo yet — customers see the first letter of your store name"
          className="flex h-[88px] w-[88px] items-center justify-center rounded-2xl bg-primary font-display text-4xl font-bold text-primary-foreground"
        >
          {storeName.slice(0, 1).toUpperCase()}
        </div>
      )}

      <p id={hintId} className="text-xs text-muted-foreground">
        {spec.hint} JPEG, PNG or WebP.
      </p>

      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          disabled={!isOwner || busy !== null}
          aria-describedby={hintId}
          className="peer sr-only"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) void upload(picked);
          }}
        />
        <label
          htmlFor={inputId}
          className={cn(
            btn,
            "cursor-pointer bg-primary text-primary-foreground shadow-xs hover:opacity-90",
            // The input is visually hidden; show its focus ring on the label.
            "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
            (!isOwner || busy !== null) && "pointer-events-none opacity-50",
          )}
        >
          {busy === "upload" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
          )}
          {url ? `Change ${spec.label.toLowerCase()}` : `Upload ${spec.label.toLowerCase()}`}
        </label>
        {url ? (
          <button
            type="button"
            onClick={remove}
            disabled={!isOwner || busy !== null}
            className={cn(btn, "border border-input bg-background hover:bg-accent")}
          >
            {busy === "remove" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            )}
            Remove
          </button>
        ) : null}
      </div>

      <p aria-live="polite" role="status" className="min-h-5 text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}

export function StoreImagesClient({ storeName, initialBannerUrl, initialLogoUrl, isOwner }: StoreImagesClientProps) {
  return (
    <div className="space-y-6">
      {!isOwner && <p className="text-sm text-muted-foreground">Only the owner can change these.</p>}
      <ImageField kind="banner" storeName={storeName} initialUrl={initialBannerUrl} isOwner={isOwner} />
      <ImageField kind="logo" storeName={storeName} initialUrl={initialLogoUrl} isOwner={isOwner} />
    </div>
  );
}
