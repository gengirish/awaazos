"use client";

import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downscaleImage } from "@/lib/image-downscale";
import { canAddPhoto, MAX_ITEM_PHOTOS, movePhoto, type PhotoRef } from "@/lib/item-photos";

/**
 * An existing item's photos in the item form (docs/PRODUCT_PAGE_PLAN.md step 3,
 * rules in lib/item-photos.ts). The first photo is the cover: the one rows,
 * tiles, the counter and link previews show. Up to MAX_ITEM_PHOTOS; the store's
 * detail sheet shows them all.
 *
 * Every change saves at once (`/api/menu/[id]/images`), like the single photo
 * did, and the server answers with the whole list, which replaces ours.
 * Reordering is two buttons per photo, so it works by keyboard and on a phone
 * without dragging. Read when the form opens; nothing polls.
 *
 * A new item has no id yet, so MenuItemForm keeps its one held photo for create.
 */

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 4 * 1024 * 1024;

export function ItemPhotosField({
  itemId,
  itemName,
  onChanged,
  onPhotos,
}: {
  itemId: string;
  itemName: string;
  onChanged: () => void;
  /** The list each time it loads or changes, with the item it belongs to: the sizes editor offers these per colour. */
  onPhotos?: (photos: PhotoRef[], itemId: string) => void;
}) {
  const [photos, setPhotosState] = useState<PhotoRef[] | null>(null);
  // Each list the server sends is also reported, tagged with the item it was loaded for.
  const reported = useRef(onPhotos);
  useEffect(() => {
    reported.current = onPhotos;
  }, [onPhotos]);
  function showPhotos(list: PhotoRef[], forItem: string) {
    setPhotosState(list);
    reported.current?.(list, forItem);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let stale = false;
    setPhotosState(null);
    fetch(`/api/menu/${itemId}/images`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data?: PhotoRef[] } | null) => {
        if (stale) return;
        const list = body?.data;
        setPhotosState(list ?? []);
        // A failed read reports nothing: an empty list would clear every colour's photo on save.
        if (list) reported.current?.(list, itemId);
      })
      .catch(() => {
        if (!stale) setPhotosState([]);
      });
    return () => {
      stale = true;
    };
  }, [itemId]);

  /** Sends one change; on success the server's list replaces ours. */
  async function send(status: string, run: () => Promise<Response>, done: string) {
    setBusy(status);
    try {
      const res = await run();
      const body = (await res.json().catch(() => ({}))) as { data?: PhotoRef[]; error?: string };
      if (Array.isArray(body.data)) showPhotos(body.data, itemId);
      if (!res.ok) {
        toast.error(errorText(body.error));
        return;
      }
      toast.success(done);
      onChanged();
    } catch {
      toast.error("Couldn't save the photos. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    // Cleared so picking the same file again still fires a change event.
    e.target.value = "";
    if (!picked) return;
    if (!ALLOWED.includes(picked.type)) {
      toast.error("Use a JPEG, PNG or WebP photo");
      return;
    }
    setBusy("Uploading photo…");
    // Phone photos are 5–12 MB; shrink before spending the seller's data.
    const file = await downscaleImage(picked, { maxWidth: 1600, maxHeight: 1600, type: "image/jpeg", quality: 0.85 });
    if (file.size > MAX_BYTES) {
      setBusy(null);
      toast.error("Photo must be 4MB or smaller");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    await send("Uploading photo…", () => fetch(`/api/menu/${itemId}/images`, { method: "POST", body: fd, credentials: "include" }), "Photo added");
  }

  function move(index: number, step: -1 | 1) {
    if (!photos) return;
    const order = movePhoto(
      photos.map((p) => p.id),
      index,
      step,
    );
    void send(
      "Saving order…",
      () =>
        fetch(`/api/menu/${itemId}/images/order`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ order }),
        }),
      index + step === 0 ? "Cover photo changed" : "Photo moved",
    );
  }

  function remove(photo: PhotoRef) {
    void send(
      "Removing photo…",
      () => fetch(`/api/menu/${itemId}/images/${encodeURIComponent(photo.id)}`, { method: "DELETE", credentials: "include" }),
      "Photo removed",
    );
  }

  const list = photos ?? [];
  const roomLeft = canAddPhoto(list.length);
  const disabled = busy !== null || photos === null;

  return (
    <div className="space-y-2" role="group" aria-labelledby="menu-item-photos-label">
      <p className="text-sm font-medium leading-none" id="menu-item-photos-label">
        Photos (optional)
      </p>
      {list.length > 0 ? (
        <ol className="flex gap-3 overflow-x-auto pb-1" aria-label={`Photos of ${itemName}, cover first`}>
          {list.map((photo, i) => (
            <li key={photo.id} className="w-28 shrink-0 space-y-1" data-testid="item-photo">
              <div className="relative">
                <Image
                  src={photo.url}
                  alt={`Photo ${i + 1} of ${itemName}`}
                  width={112}
                  height={112}
                  sizes="112px"
                  className="h-28 w-28 rounded-md border object-cover"
                />
                {i === 0 ? (
                  <span className="absolute left-1 top-1 rounded bg-background/90 px-1.5 py-0.5 text-xs font-semibold text-foreground">
                    Cover
                  </span>
                ) : null}
              </div>
              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11"
                  disabled={disabled || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={i === 1 ? `Make photo ${i + 1} the cover` : `Move photo ${i + 1} left`}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11"
                  disabled={disabled}
                  onClick={() => remove(photo)}
                  aria-label={`Remove photo ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11"
                  disabled={disabled || i === list.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move photo ${i + 1} right`}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {roomLeft ? (
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={`item-photos-add-${itemId}`}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
            {list.length === 0 ? "Choose photo" : "Add photo"}
          </label>
          <input
            ref={galleryRef}
            id={`item-photos-add-${itemId}`}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={disabled}
            onChange={onPick}
          />
          {/* Camera only: `capture` restricts the picker, so the gallery input above stays. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            disabled={disabled}
            onChange={onPick}
          />
          <Button type="button" variant="outline" className="min-h-11 sm:hidden" disabled={disabled} onClick={() => cameraRef.current?.click()}>
            Take photo
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {busy ??
          (photos === null
            ? "Loading photos…"
            : roomLeft
              ? `Up to ${MAX_ITEM_PHOTOS} photos. The first is the cover; buyers swipe through the rest on your store page.`
              : `That's ${MAX_ITEM_PHOTOS} photos, the most an item can have. Remove one to add another.`)}
      </p>
    </div>
  );
}

function errorText(code: string | undefined): string {
  switch (code) {
    case "too_many_photos":
      return `An item can have ${MAX_ITEM_PHOTOS} photos at most.`;
    case "photos_changed":
      return "The photos changed in another window. Here they are now.";
    case "photo_uploads_unavailable":
      return "Photo uploads aren't available right now.";
    default:
      return code && code.length < 80 && !code.includes("_") ? code : "Couldn't save the photos.";
  }
}
