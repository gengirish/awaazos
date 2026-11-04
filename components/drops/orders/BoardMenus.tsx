"use client";

import type { FulfilmentMode } from "@prisma/client";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Info,
  Instagram,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Share2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AiImagePromptForm } from "@/components/ai/AiImagePromptForm";
import { useInstagramStory } from "@/components/drops/InstagramStoryButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { AI_IMAGES_ENABLED } from "@/lib/ai-image-types";
import { buildDropShareText, buildWhatsAppShareUrl, shareOrOpenWhatsApp } from "@/lib/drops-share";
import { cn } from "@/lib/utils";

/**
 * The orders board header's menus, in their own file so OrdersBoard can load
 * them with next/dynamic: the menu primitives are heavy and aren't needed to
 * read the orders.
 */

/** An ⓘ that opens on tap as well as on keyboard: hover tooltips don't exist on a phone. */
export function BoardInfoHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={label}>
          <Info aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] text-sm">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export type ShareDropTarget = {
  id: string;
  title: string;
  closesAt: string;
  fulfilmentStartsAt: string;
  fulfilmentEndsAt: string;
  fulfilmentMode: FulfilmentMode;
  itemNames: string[];
};

function statusToast(message: string) {
  if (message) toast(message);
}

/**
 * One Share button for everything the board can share: the open drop, or the
 * store while it takes menu orders; plus a link to the live store. Renders
 * nothing when there is nothing to offer. Remount it (`key`) when the drop
 * changes: it holds that drop's prepared story image, between that flow's two taps.
 */
export function BoardShareMenu({
  vendorName,
  vendorSlug,
  drop,
  shareStore,
  storeIsLive,
}: {
  vendorName: string;
  vendorSlug: string;
  /** The drop to share while it is taking orders. Wins over `shareStore`. */
  drop: ShareDropTarget | null;
  shareStore: boolean;
  storeIsLive: boolean;
}) {
  // window is unavailable during SSR; fill the origin in after mount.
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [aiStoryOpen, setAiStoryOpen] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const storeHref = `/s/${encodeURIComponent(vendorSlug)}`;
  const url = `${origin}${storeHref}`;
  const canShare = drop !== null || shareStore;

  const shareText = useMemo(
    () =>
      drop
        ? buildDropShareText({
            vendorName,
            dropTitle: drop.title,
            closesAt: new Date(drop.closesAt),
            fulfilmentStartsAt: new Date(drop.fulfilmentStartsAt),
            fulfilmentEndsAt: new Date(drop.fulfilmentEndsAt),
            fulfilmentMode: drop.fulfilmentMode,
            itemNames: drop.itemNames,
            url,
          })
        : `Order from ${vendorName}: ${url}`,
    [drop, vendorName, url],
  );

  const story = useInstagramStory({
    src: drop ? `/api/drops/${encodeURIComponent(drop.id)}/story-image` : "/api/vendor/story-image",
    fileName: drop ? "drop-story.png" : "store-story.png",
    url,
    onStatus: statusToast,
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(drop ? shareText : url);
      setCopied(true);
    } catch {
      toast.error(drop ? "Couldn't copy. Use WhatsApp instead." : "Couldn't copy. Use Share store link instead.");
    }
  }

  if (!canShare && !storeIsLive) return null;

  const CopyIcon = copied ? Check : Copy;

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" className="shrink-0">
            <Share2 aria-hidden />
            Share
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canShare && (
            <>
              <DropdownMenuItem
                onSelect={() =>
                  void shareOrOpenWhatsApp({
                    title: drop ? `${drop.title} by ${vendorName}` : vendorName,
                    text: shareText,
                    url,
                  })
                }
              >
                <Share2 aria-hidden />
                {drop ? "Share this drop" : "Share store link"}
              </DropdownMenuItem>
              {/* Stays open: the item itself says "Copied". */}
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  void copy();
                }}
              >
                <CopyIcon aria-hidden />
                {copied ? "Copied" : drop ? "Copy message" : "Copy link"}
              </DropdownMenuItem>
              {drop && (
                <DropdownMenuItem onSelect={() => window.open(buildWhatsAppShareUrl(shareText), "_blank", "noopener,noreferrer")}>
                  <MessageCircle aria-hidden />
                  WhatsApp
                </DropdownMenuItem>
              )}
              {story.ready ? (
                <>
                  <DropdownMenuItem onSelect={() => void story.share(story.ready!)}>
                    <Instagram aria-hidden />
                    Share story image
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => story.download(story.ready!)}>
                    <Download aria-hidden />
                    Download story image
                  </DropdownMenuItem>
                </>
              ) : (
                // Stays open: the second tap of the story flow happens right here.
                <DropdownMenuItem
                  aria-busy={story.loading}
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!story.loading) void story.prepare();
                  }}
                >
                  {story.loading ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                  ) : (
                    <Instagram aria-hidden />
                  )}
                  Instagram story
                </DropdownMenuItem>
              )}
              {AI_IMAGES_ENABLED && !story.ready && (
                // A dialog, not an inline form: a menu takes every key for its own navigation.
                <DropdownMenuItem onSelect={() => setAiStoryOpen(true)}>
                  <Sparkles aria-hidden />
                  Story with an AI background
                </DropdownMenuItem>
              )}
            </>
          )}
          {canShare && storeIsLive && <DropdownMenuSeparator />}
          {storeIsLive && (
            <DropdownMenuItem asChild>
              <a href={storeHref} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                Open store
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {AI_IMAGES_ENABLED && (
        <ResponsiveDialog open={aiStoryOpen} onOpenChange={setAiStoryOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Story with an AI background</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>The story image over a background you describe.</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody>
              <AiImagePromptForm
                label="Describe the background"
                placeholder="Warm morning light on a wooden table"
                submitLabel="Make story image"
                busy={story.loading}
                onSubmit={(prompt) => {
                  void story.prepare(prompt);
                  setAiStoryOpen(false);
                }}
              />
            </ResponsiveDialogBody>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}
    </>
  );
}

export type OverflowLink = { label: string; href: string; icon: LucideIcon };

/** The header's "⋯": links to where this board's orders are set up. */
export function BoardOverflowMenu({ links }: { links: OverflowLink[] }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label="More actions">
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {links.map(({ label, href, icon: Icon }) => (
          <DropdownMenuItem key={href} asChild>
            <Link href={href}>
              <Icon aria-hidden />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * "Taking orders" / "Paused": whether buyers can order from the everyday
 * catalogue right now (`acceptMenuOrders`, the Settings → Online orders switch).
 * The owner can change it from here; everyone else reads it. Drops have their
 * own status and aren't touched by it.
 */
export function MenuStatusPill({
  accepting,
  modeLabel,
  canChange,
  pending,
  onChange,
}: {
  accepting: boolean;
  /** How orders are handed over, e.g. "Delivery or pickup". */
  modeLabel: string;
  canChange: boolean;
  pending: boolean;
  onChange: (accepting: boolean) => void;
}) {
  const label = accepting ? "Taking orders" : "Paused";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Order status: ${label}`}
        aria-busy={pending}
        className={cn(
          "touch-target inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          accepting ? "border-primary bg-primary/10" : "border-border bg-muted",
        )}
      >
        {/* The word carries the state; the dot only repeats it. */}
        <span
          aria-hidden
          className={cn("h-2 w-2 rounded-full", accepting ? "bg-primary" : "border border-muted-foreground")}
        />
        {label}
        <ChevronDown className="h-4 w-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal text-muted-foreground">{modeLabel}</DropdownMenuLabel>
        {canChange ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={accepting ? "open" : "paused"}
              onValueChange={(value) => onChange(value === "open")}
            >
              <DropdownMenuRadioItem value="open" disabled={pending}>
                Taking orders
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="paused" disabled={pending}>
                Paused
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        ) : (
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            Only the owner can pause orders.
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
