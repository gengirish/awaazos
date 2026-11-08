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
 * width of a gallery card (goods stores). With `enlarge`, a photo opens
 * full-size in a dialog on tap: a jewellery buyer wants to see the beads,
 * and an 80 px thumbnail hides them. The emoji tile never opens anything.
 */
export type ItemPhotoProps = {
  src: string | null;
  emoji: string;
  /** The item's name: the dialog title and the photo's alt text when enlarged. */
  name: string;
  size: "row" | "tile";
  enlarge?: boolean;
  /** Sold out: the picture is dimmed. */
  dimmed?: boolean;
};

const FRAME: Record<ItemPhotoProps["size"], string> = {
  row: "h-20 w-20 shrink-0 rounded-xl",
  tile: "aspect-square w-full rounded-xl",
};

export function ItemPhoto({ src, emoji, name, size, enlarge = false, dimmed = false }: ItemPhotoProps) {
  const [open, setOpen] = useState(false);

  if (!src) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          FRAME[size],
          "flex items-center justify-center bg-primary/10",
          size === "tile" ? "text-5xl" : "text-3xl",
          dimmed && "opacity-50",
        )}
      >
        {emoji}
      </span>
    );
  }

  const picture = (
    <Image
      src={src}
      alt=""
      width={size === "tile" ? 480 : 80}
      height={size === "tile" ? 480 : 80}
      sizes={size === "tile" ? "(min-width: 640px) 33vw, 50vw" : "80px"}
      className={cn(FRAME[size], "object-cover ring-1 ring-border/60", dimmed && "opacity-50")}
    />
  );

  if (!enlarge) return picture;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`See the photo of ${name}`}
        className={cn(
          FRAME[size],
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
            className="max-h-[80dvh] w-full rounded-b-2xl object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
