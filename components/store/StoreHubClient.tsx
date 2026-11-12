"use client";

import { useState, useTransition, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Download,
  EyeOff,
  ExternalLink,
  Instagram,
  Loader2,
  MessageCircle,
  QrCode,
  Share2,
} from "lucide-react";
import { toast } from "sonner";

import { useInstagramStory } from "@/components/drops/InstagramStoryButton";
import { SaveQrButton } from "@/components/storefront/SaveQrButton";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { buildTaggedWhatsAppShareUrl } from "@/lib/drops-share";
import { withInstagramTag } from "@/lib/order-channel";
import type { LookRow, OrderingSummary } from "@/lib/store-hub";
import { cn } from "@/lib/utils";

/**
 * "Your store" (/store), behind the raised Store tab. Rules and words come from
 * the page (lib/store-hub.ts); this draws them and runs the taps:
 *  - Publish: the same `PATCH /api/vendor { publishStorefront }` as Settings →
 *    Online store (OWNER only on the server), then a re-render so the shell
 *    sees the change.
 *  - Instagram bio link and WhatsApp carry `src=ig` / `src=wa`
 *    (lib/order-channel.ts) so their orders are counted by channel; Copy link
 *    and the share sheet keep the plain link.
 *  - The story image is the store's (`/api/vendor/story-image`), two taps, as on
 *    the Orders screen's Share menu.
 */
export type StoreHubClientProps = {
  storeName: string;
  /** `/s/<slug>` once published; null while hidden. */
  storePath: string | null;
  /** The public link (from the server's origin); null while hidden. */
  storeUrl: string | null;
  /** From `qrSvgDataUrl` / `qrPngDataUrl`; empty while hidden. */
  qrSvg: string;
  qrPng: string;
  /** File name for the saved QR, without extension. */
  qrFileName: string;
  /** Publish and the look rows. */
  isOwner: boolean;
  /** "Open a drop" when nothing takes orders (MANAGER+). */
  canOpenDrop: boolean;
  preview: { bannerUrl: string | null; logoUrl: string | null; theme: string | null; tagline: string | null };
  itemCount: number;
  /** "item" / "items" in the store's words. */
  itemWord: string;
  ratingText: string | null;
  ordering: OrderingSummary;
  /** "Order from menu" / "Order any time". */
  catalogueOrdersTitle: string;
  look: LookRow[];
};

const ROW =
  "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left ring-inset transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 motion-reduce:transition-none";
const ROW_ICON = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 font-display text-lg font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function StoreHubClient(props: StoreHubClientProps) {
  const { storeName, storePath, storeUrl, isOwner, preview, look } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [storyStatus, setStoryStatus] = useState("");
  const published = Boolean(storePath && storeUrl);
  const story = useInstagramStory({
    src: "/api/vendor/story-image",
    fileName: "store-story.png",
    url: storeUrl ?? "",
    onStatus: setStoryStatus,
  });

  function publish() {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ publishStorefront: true }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(body.error ?? "Could not publish your store.");
          return;
        }
        toast.success("Your store is live.");
        router.refresh();
      } catch {
        toast.error("Network error. Please try again.");
      }
    });
  }

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
      return true;
    } catch {
      toast.error("Could not copy. Press and hold the link to copy it.");
      return false;
    }
  }

  async function copyLink() {
    if (!storeUrl) return;
    if (await copy(storeUrl, "Link copied.")) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  /** The phone's share sheet (WhatsApp, Instagram…), or a copied link where there is none. */
  async function shareLink() {
    if (!storeUrl) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: storeName, text: `Order from ${storeName} online`, url: storeUrl });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // Share API present but refused (permission policy): copy instead.
      }
    }
    await copyLink();
  }

  function shareOnWhatsApp() {
    if (!storeUrl) return;
    const text = `Order from ${storeName} online: ${storeUrl}`;
    window.open(buildTaggedWhatsAppShareUrl(text, storeUrl), "_blank", "noopener,noreferrer");
  }

  const statusLine = [
    `${props.itemCount} ${props.itemWord}`,
    ...(props.ratingText ? [`★ ${props.ratingText}`] : []),
  ].join(" · ");

  const previewCard = (
    <section aria-labelledby="store-status-heading" className="overflow-hidden rounded-lg border bg-card">
      {/* A small copy of the store page's header, in the store's own colour. */}
      <div data-theme={preview.theme ?? undefined} className="relative bg-linear-to-b from-primary/20 to-background">
        {preview.bannerUrl ? (
          <div aria-hidden="true" className="relative h-24">
            <Image src={preview.bannerUrl} alt="" fill sizes="(min-width: 640px) 576px, 100vw" className="object-cover" />
          </div>
        ) : (
          <div aria-hidden="true" className="h-10" />
        )}
        <div className={cn("flex items-center gap-3 px-4 pb-3", preview.bannerUrl ? "-mt-6" : "")}>
          {preview.logoUrl ? (
            <Image
              src={preview.logoUrl}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-xl bg-background object-cover shadow-md ring-4 ring-background"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary font-display text-2xl font-bold text-primary-foreground shadow-md ring-4 ring-background"
            >
              {storeName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className={cn("min-w-0", preview.bannerUrl ? "pt-6" : "")}>
            <p className="truncate font-display text-lg font-bold leading-tight text-foreground">{storeName}</p>
            {preview.tagline ? <p className="truncate text-sm text-muted-foreground">{preview.tagline}</p> : null}
          </div>
        </div>
      </div>

      <div className="border-t p-4">
        <h2 id="store-status-heading" className="flex items-center gap-2 font-semibold text-foreground">
          {published ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <EyeOff className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          {published ? "Open to buyers" : "Hidden from buyers"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{statusLine}</p>
        {published ? (
          <>
            <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{storeUrl}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button asChild>
                <a href={storePath!} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden="true" />
                  Open live store
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </Button>
              <Button type="button" variant="outline" onClick={() => void shareLink()}>
                <Share2 aria-hidden="true" />
                Share link
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Your store link doesn&rsquo;t open for buyers until the store is published.
            </p>
            {isOwner ? (
              <Button
                type="button"
                className="mt-4 w-full sm:w-auto"
                onClick={publish}
                disabled={pending}
                aria-busy={pending}
              >
                Publish store
              </Button>
            ) : (
              <p className="mt-3 text-sm font-medium text-foreground">Ask the store owner to publish it.</p>
            )}
          </>
        )}
      </div>
    </section>
  );

  const orderingSection = (
    <Section id="store-ordering-heading" title="Taking orders">
      <div className="rounded-lg border bg-card p-4 text-sm">
        {props.ordering.idle ? (
          <p className="text-foreground">Not taking orders yet.</p>
        ) : (
          <ul className="space-y-2">
            {props.ordering.lines.map((line) => (
              <li key={line.text} className="flex items-start gap-2 text-foreground">
                {line.tone === "on" ? (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 fill-success text-success" aria-hidden="true" />
                ) : (
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4">
          {props.ordering.idle && props.canOpenDrop ? (
            <Link href="/drops/new" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
              Open a drop
            </Link>
          ) : null}
          {props.ordering.idle && isOwner ? (
            <Link href="/settings/orders" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
              Turn on {props.catalogueOrdersTitle}
            </Link>
          ) : null}
          {!props.ordering.idle ? (
            <Link href="/orders" className="inline-flex min-h-11 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
              Go to Orders
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>
    </Section>
  );

  const shareSection = published ? (
    <Section id="store-share-heading" title="Bring buyers to your store">
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        <li>
          <button
            type="button"
            className={ROW}
            onClick={() =>
              void copy(withInstagramTag(storeUrl!), "Bio link copied. Paste it into your Instagram bio.")
            }
          >
            <span className={ROW_ICON}>
              <Copy className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-foreground">Copy Instagram bio link</span>
              <span className="block text-sm text-muted-foreground">Orders from it show as Instagram.</span>
            </span>
          </button>
        </li>
        <li>
          {story.ready ? (
            <div className="flex items-stretch">
              <button type="button" className={cn(ROW, "flex-1")} onClick={() => void story.share(story.ready!)}>
                <span className={cn(ROW_ICON, "bg-primary text-primary-foreground")}>
                  <Instagram className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-semibold text-foreground">Share story image</span>
              </button>
              <button
                type="button"
                className={cn(ROW, "w-auto border-l px-4")}
                onClick={() => story.download(story.ready!)}
                aria-label="Download story image"
              >
                <Download className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            // First tap makes the image; the second shares it (iOS drops the gesture across a fetch).
            <button
              type="button"
              className={ROW}
              disabled={story.loading}
              aria-busy={story.loading}
              onClick={() => void story.prepare()}
            >
              <span className={ROW_ICON}>
                {story.loading ? (
                  <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Instagram className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">Instagram story image</span>
                <span className="block text-sm text-muted-foreground">A ready-made picture of your store.</span>
              </span>
            </button>
          )}
        </li>
        <li>
          <button type="button" className={ROW} onClick={shareOnWhatsApp}>
            <span className={ROW_ICON}>
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-foreground">Share on WhatsApp</span>
              <span className="block text-sm text-muted-foreground">Orders from it show as WhatsApp.</span>
            </span>
          </button>
        </li>
        <li className="grid grid-cols-2 divide-x">
          <button type="button" className={ROW} onClick={() => setQrOpen(true)}>
            <QrCode className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="font-semibold text-foreground">Show QR code</span>
          </button>
          <button type="button" className={ROW} onClick={() => void copyLink()}>
            {copied ? (
              <Check className="h-5 w-5 shrink-0" aria-hidden="true" />
            ) : (
              <Copy className="h-5 w-5 shrink-0" aria-hidden="true" />
            )}
            <span className="font-semibold text-foreground">{copied ? "Copied" : "Copy link"}</span>
          </button>
        </li>
      </ul>
      <p aria-live="polite" className="mt-2 text-sm text-muted-foreground empty:hidden">
        {storyStatus}
      </p>
    </Section>
  ) : null;

  const lookSection = isOwner ? (
    <Section id="store-look-heading" title="Make it look like yours">
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {look.map((row) => (
          <li key={row.id}>
            <Link href={`/settings/store#${row.id}`} className={ROW}>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">{row.label}</span>
                <span className={cn("block truncate text-sm", row.done ? "text-muted-foreground" : "text-primary")}>
                  {row.value}
                </span>
              </span>
              {row.done ? (
                <>
                  <Check className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                  <span className="sr-only">(done)</span>
                </>
              ) : null}
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  ) : null;

  return (
    <div className="space-y-6">
      {previewCard}
      {/* A hidden store gets its look sorted before anything else; a live one leads with orders. */}
      {published ? (
        <>
          {orderingSection}
          {shareSection}
          {lookSection}
        </>
      ) : (
        <>
          {lookSection}
          {orderingSection}
        </>
      )}

      {published ? (
        <ResponsiveDialog open={qrOpen} onOpenChange={setQrOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Your store&rsquo;s QR code</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Buyers scan it with their phone camera to open your store. Print it or post it.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody className="space-y-4 pb-6">
              {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL, nothing to optimise */}
              <img
                src={props.qrSvg}
                alt={`QR code for ${storeUrl}`}
                width={240}
                height={240}
                className="mx-auto rounded-md bg-white p-2"
              />
              <SaveQrButton pngDataUrl={props.qrPng} fileName={props.qrFileName} />
            </ResponsiveDialogBody>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      ) : null}
    </div>
  );
}
