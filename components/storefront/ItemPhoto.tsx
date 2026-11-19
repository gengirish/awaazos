"use client";

import Image from "next/image";
import { useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A catalogue item's picture on the public store: the seller's photo (or a
 * dish drawing, lib/food-images.ts), else its emoji on a tinted tile.
 *
 * `size="row"` is the 80 px square of the list rows; `size="tile"` fills the
 * width of a gallery card (goods stores); `size="hero"` is the top of an item's
 * detail sheet (ItemDetailSheet.tsx). A `portrait` tile is 3:4 instead of square
 * (clothing stores: a kurti photographed whole is taller than it is wide).
 *
 * Two ways a tap does something, never both:
 * - `onOpen`: the picture opens the item's detail sheet. The item's name is the
 *   accessible trigger for that, so this copy is a pointer-only shortcut:
 *   out of the tab order and hidden from screen readers.
 * - `enlarge`: a photo opens full-size in a dialog (the hero in the sheet). A
 *   jewellery buyer wants to see the beads. The emoji tile never opens anything.
 */
export type ItemPhotoProps = {
  src: string | null;
  emoji: string;
  /** The item's name: the dialog title and the photo's alt text when enlarged. */
  name: string;
  size: "row" | "tile" | "hero";
  enlarge?: boolean;
  /** Opens the item's detail sheet. */
  onOpen?: () => void;
  /** Sold out: the picture is dimmed. */
  dimmed?: boolean;
  /** The enlarge button's name; default "See the photo of <name>". */
  label?: string;
  /** A 3:4 tile instead of a square one (`size="tile"` only). */
  portrait?: boolean;
};

const FRAME: Record<ItemPhotoProps["size"], string> = {
  row: "h-20 w-20 shrink-0 rounded-xl",
  tile: "aspect-square w-full rounded-xl",
  hero: "aspect-square w-full rounded-2xl",
};

const PORTRAIT_TILE = "aspect-[3/4] w-full rounded-xl";

const PIXELS: Record<ItemPhotoProps["size"], { px: number; sizes: string }> = {
  row: { px: 80, sizes: "80px" },
  tile: { px: 480, sizes: "(min-width: 640px) 33vw, 50vw" },
  hero: { px: 720, sizes: "(min-width: 768px) 32rem, 100vw" },
};

const EMOJI_SIZE: Record<ItemPhotoProps["size"], string> = {
  row: "text-3xl",
  tile: "text-5xl",
  hero: "text-7xl",
};

export function ItemPhoto({
  src,
  emoji,
  name,
  size,
  enlarge = false,
  onOpen,
  dimmed = false,
  label,
  portrait = false,
}: ItemPhotoProps) {
  const [open, setOpen] = useState(false);
  const tall = portrait && size === "tile";
  const frame = tall ? PORTRAIT_TILE : FRAME[size];

  const picture = src ? (
    <Image
      src={src}
      alt=""
      width={PIXELS[size].px}
      height={tall ? (PIXELS[size].px * 4) / 3 : PIXELS[size].px}
      sizes={PIXELS[size].sizes}
      className={cn(frame, "object-cover ring-1 ring-border/60", dimmed && "opacity-50")}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn(frame, "flex items-center justify-center bg-primary/10", EMOJI_SIZE[size], dimmed && "opacity-50")}
    >
      {emoji}
    </span>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onOpen}
        className={cn(frame, "block cursor-pointer overflow-hidden")}
      >
        {picture}
      </button>
    );
  }

  if (!enlarge || !src) return picture;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label ?? `See the photo of ${name}`}
        className={cn(
          frame,
          "block overflow-hidden ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        {picture}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(92vw,40rem)] gap-0 rounded-2xl border-0 bg-background p-0">
          <DialogTitle className="px-4 pr-12 pt-3 text-base">{name}</DialogTitle>
          <Image
            src={src}
            alt={name}
            width={1200}
            height={1200}
            sizes="92vw"
            className="max-h-[80dvh] w-full touch-pinch-zoom rounded-b-2xl object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
