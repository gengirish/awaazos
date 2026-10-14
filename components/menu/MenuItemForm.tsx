"use client";

import type { MenuItem } from "@prisma/client";
import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ShowOnlineSwitch } from "@/components/menu/ShowOnlineSwitch";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { paiseToRupees } from "@/lib/currency";
import { suggestEmoji } from "@/lib/menu-suggestions";
import { categoryOptions, paiseToRupeeInput, parseRupeeInput } from "@/lib/menu-voice";
import { cn } from "@/lib/utils";
import { menuItemCreateInputSchema, menuItemUpdateSchema } from "@/lib/zod-menu";

/** Starter emoji grid, shared with the voice menu builder's review rows. */
export const FOOD_EMOJIS = [
  "🍽️",
  "🥘",
  "🍛",
  "🍜",
  "🍲",
  "🥗",
  "🥪",
  "🌯",
  "🌮",
  "🥙",
  "🍕",
  "🍔",
  "🌭",
  "🥨",
  "🥐",
  "🍞",
  "🥖",
  "🧀",
  "🍳",
  "🥞",
] as const;

const DEFAULT_EMOJI = "🍽️";

/** Mirrors the server-side allowlist in app/api/menu/[id]/image/route.ts. */
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * The form's own schema: the shared create fields, except that the price stays
 * the text the seller typed ("19.", "19.50") until submit. It becomes paise
 * through `parseRupeeInput` (→ `rupeesToPaise`) there; the API contract is unchanged.
 */
const menuItemFormSchema = menuItemCreateInputSchema.extend({
  priceInRupees: z.string().superRefine((value, ctx) => {
    const parsed = parseRupeeInput(value);
    if ("error" in parsed) ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error });
  }),
});

export type MenuItemFormValues = z.infer<typeof menuItemFormSchema>;

const defaultCreateValues: MenuItemFormValues = {
  name: "",
  priceInRupees: "",
  aliasesCsv: "",
  tagsCsv: "",
  emoji: DEFAULT_EMOJI,
  // Empty saves as "General" (the server default); the datalist offers the rest.
  category: "",
  hsnCode: "",
  isPopular: false,
  isAvailable: true,
  showOnline: true,
};

type MenuItemFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: MenuItem | null;
  onSaved: () => void;
  /** Create only: pre-fill the name (e.g. a dish heard by the voice drop builder). */
  defaultName?: string;
  /** Categories already on this vendor's menu, offered as suggestions. */
  categories?: readonly string[];
};

const NO_CATEGORIES: readonly string[] = [];

export function MenuItemForm({
  open,
  onOpenChange,
  item,
  onSaved,
  defaultName = "",
  categories = NO_CATEGORIES,
}: MenuItemFormProps) {
  const isEdit = Boolean(item);
  const uid = useId();
  const categoryListId = `${uid}-categories`;
  const moreId = `${uid}-more`;
  const categorySuggestions = useMemo(() => categoryOptions(categories), [categories]);
  // Aliases, tags, HSN/SAC and the emoji: rarely needed, so they start folded away.
  const [moreOpen, setMoreOpen] = useState(false);

  // The photo is not part of the RHF schema: it round-trips through
  // /api/menu/[id]/image, which needs an item id. On edit we upload
  // immediately; on create we hold the file and upload once the id exists.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // New items only: the emoji follows the name (suggestEmoji) until the vendor
  // taps one themselves. A manual pick is final, and editing never auto-picks —
  // an existing item's emoji is the vendor's data.
  const [emojiPicked, setEmojiPicked] = useState(false);
  const [emojiSuggested, setEmojiSuggested] = useState(false);

  const form = useForm<MenuItemFormValues>({
    resolver: zodResolver(menuItemFormSchema),
    defaultValues: defaultCreateValues,
  });
  const { errors, isSubmitting } = form.formState;
  // A problem in a folded field must be visible, whatever the seller last tapped.
  const moreShown =
    moreOpen || Boolean(errors.aliasesCsv || errors.tagsCsv || errors.hsnCode || errors.emoji);

  useEffect(() => {
    if (!open) return;
    setImageUrl(item?.imageUrl ?? null);
    setPendingFile(null);
    setImageBusy(false);
    setEmojiPicked(false);
    setEmojiSuggested(false);
    // On edit, open "More options" when one of its text fields is in use.
    setMoreOpen(Boolean(item && (item.aliases.length > 0 || item.tags.length > 0 || item.hsnCode)));
    if (item) {
      form.reset({
        name: item.name,
        priceInRupees: paiseToRupeeInput(item.priceInPaise),
        aliasesCsv: item.aliases.length ? item.aliases.join(", ") : "",
        tagsCsv: item.tags.length ? item.tags.join(", ") : "",
        emoji: item.emoji,
        category: item.category,
        hsnCode: item.hsnCode ?? "",
        isPopular: item.isPopular,
        isAvailable: item.isAvailable,
        showOnline: item.showOnline,
      });
    } else {
      const suggestion = defaultName ? suggestEmoji(defaultName) : null;
      form.reset({
        ...defaultCreateValues,
        name: defaultName,
        emoji: suggestion ?? DEFAULT_EMOJI,
      });
      setEmojiSuggested(suggestion !== null);
    }
  }, [open, item, form, defaultName]);

  function validateImage(file: File): string | null {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP photo";
    if (file.size > MAX_IMAGE_BYTES) return "Photo must be 4MB or smaller";
    return null;
  }

  /** POSTs to the upload route; returns the stored URL, or null on failure. */
  async function uploadImage(itemId: string, file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/menu/${itemId}/image`, { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(typeof json.error === "string" ? json.error : "Could not upload photo");
      return null;
    }
    return typeof json?.data?.imageUrl === "string" ? json.data.imageUrl : null;
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear the input so re-picking the same file still fires a change event.
    e.target.value = "";
    if (!file) return;
    const problem = validateImage(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (isEdit && item) {
      setImageBusy(true);
      try {
        const url = await uploadImage(item.id, file);
        if (url) {
          setImageUrl(url);
          toast.success("Photo updated");
          onSaved();
        }
      } catch {
        toast.error("Could not upload photo");
      } finally {
        setImageBusy(false);
      }
    } else {
      setPendingFile(file);
    }
  }

  async function removePhoto() {
    if (pendingFile) {
      setPendingFile(null);
      return;
    }
    if (!item || !imageUrl) return;
    setImageBusy(true);
    try {
      const res = await fetch(`/api/menu/${item.id}/image`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Could not remove photo");
        return;
      }
      setImageUrl(null);
      toast.success("Photo removed");
      onSaved();
    } catch {
      toast.error("Could not remove photo");
    } finally {
      setImageBusy(false);
    }
  }

  /** `addAnother` (create only): keep the sheet open, cleared, for the next item. */
  async function save(values: MenuItemFormValues, addAnother: boolean) {
    const price = parseRupeeInput(values.priceInRupees);
    if ("error" in price) {
      form.setError("priceInRupees", { message: price.error }, { shouldFocus: true });
      return;
    }
    const fields = {
      name: values.name,
      priceInRupees: paiseToRupees(price.paise),
      aliasesCsv: values.aliasesCsv ?? "",
      tagsCsv: values.tagsCsv ?? "",
      emoji: values.emoji,
      category: values.category?.trim() || "General",
      isPopular: values.isPopular,
      isAvailable: values.isAvailable,
      showOnline: values.showOnline,
    };
    try {
      if (isEdit && item) {
        const body = menuItemUpdateSchema.parse({ ...fields, hsnCode: values.hsnCode?.trim() || null });
        const res = await fetch(`/api/menu/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(typeof json.error === "string" ? json.error : "Could not update item");
          return;
        }
        toast.success("Menu item updated");
      } else {
        const res = await fetch("/api/menu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...fields, hsnCode: values.hsnCode ?? "" }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(typeof json.error === "string" ? json.error : "Could not create item");
          return;
        }
        toast.success(addAnother ? `${values.name} added. Add the next one.` : "Menu item created");
        // The item exists now, so the held photo finally has an id to attach to.
        // A failed upload has already toasted; the item itself is still saved.
        if (pendingFile && typeof json?.data?.id === "string") {
          await uploadImage(json.data.id, pendingFile);
        }
        if (addAnother) {
          // Same category again: sellers add a whole section in one go.
          form.reset({ ...defaultCreateValues, category: values.category?.trim() ?? "" });
          setPendingFile(null);
          setEmojiPicked(false);
          setEmojiSuggested(false);
          setMoreOpen(false);
          onSaved();
          form.setFocus("name");
          return;
        }
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        className="md:max-w-md"
        aria-labelledby="menu-item-form-title"
        aria-describedby="menu-item-form-desc"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle id="menu-item-form-title">{isEdit ? "Edit item" : "Add menu item"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription id="menu-item-form-desc">
            Enter the price in rupees.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <Form {...form}>
          {/* The fields scroll; Cancel / Save stay pinned under them. */}
          <form onSubmit={form.handleSubmit((values) => save(values, false))} className="flex min-h-0 flex-1 flex-col">
            <ResponsiveDialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="off"
                        placeholder="e.g. Bhel puri"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          if (isEdit || emojiPicked) return;
                          const suggestion = suggestEmoji(e.target.value);
                          form.setValue("emoji", suggestion ?? DEFAULT_EMOJI);
                          setEmojiSuggested(suggestion !== null);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priceInRupees"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price (₹)</FormLabel>
                    <FormControl>
                      {/* The typed text is kept as it is ("19." must survive); it becomes paise on submit. */}
                      <Input inputMode="decimal" autoComplete="off" placeholder="e.g. 40 or 19.50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-2" role="group" aria-labelledby="menu-item-photo-label">
                <p className="text-sm font-medium leading-none" id="menu-item-photo-label">
                  Photo (optional)
                </p>
                {imageUrl ? (
                  <Image
                    src={imageUrl}
                    alt={`Current photo of ${item?.name ?? "this item"}`}
                    width={96}
                    height={96}
                    sizes="96px"
                    className="h-24 w-24 rounded-md border object-cover"
                  />
                ) : null}
                {pendingFile ? (
                  <p className="text-sm text-foreground" aria-live="polite">
                    Selected: {pendingFile.name} — uploads when you create the item.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <label
                    htmlFor="menu-item-photo"
                    className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
                  >
                    {imageUrl || pendingFile ? "Change photo" : "Choose photo"}
                  </label>
                  <input
                    id="menu-item-photo"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={imageBusy}
                    onChange={onPickFile}
                  />
                  {/*
                    Separate camera input: `capture` restricts the picker to the
                    camera on both iOS and Android, so it cannot be the only entry
                    point — vendors also need the gallery.
                  */}
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    aria-hidden
                    tabIndex={-1}
                    disabled={imageBusy}
                    onChange={onPickFile}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 sm:hidden"
                    disabled={imageBusy}
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    Take photo
                  </Button>
                  {imageUrl || pendingFile ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={imageBusy}
                      onClick={removePhoto}
                    >
                      Remove photo
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {imageBusy
                    ? "Uploading photo…"
                    : "JPEG, PNG or WebP, up to 4MB. Shown on your store page and at the counter."}
                </p>
              </div>
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="off"
                        list={categoryListId}
                        maxLength={80}
                        placeholder="General"
                        {...field}
                        value={field.value ?? ""}
                        // Suggestions filter on the text in the box: select it so one tap shows them all.
                        onFocus={(e) => e.target.select()}
                      />
                    </FormControl>
                    <datalist id={categoryListId}>
                      {categorySuggestions.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    <FormDescription>Pick one or type your own, like Cakes or Thalis.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="rounded-md border border-border">
                <button
                  type="button"
                  aria-expanded={moreShown}
                  aria-controls={moreId}
                  onClick={() => setMoreOpen(!moreShown)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span>
                    More options
                    <span className="block text-xs font-normal text-muted-foreground">
                      Voice aliases, tags, HSN/SAC code, emoji
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none",
                      moreShown && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </button>
                {/* Folded with `hidden`, not unmounted: the fields keep their values and their place in the form. */}
                <div id={moreId} hidden={!moreShown} className="space-y-4 border-t border-border p-3">
                  <FormField
                    control={form.control}
                    name="aliasesCsv"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Voice aliases</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="off"
                            placeholder="bhel, spicy bhel"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormDescription>Comma-separated phrases customers might say.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tagsCsv"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tags</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="off"
                            autoCapitalize="none"
                            className="h-11"
                            placeholder="quiche, paneer"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormDescription>
                          Comma-separated labels of your own. Offers use them to pick items, for example
                          10% off 4 or more items tagged quiche.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="hsnCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>HSN/SAC code (optional)</FormLabel>
                        <FormControl>
                          <Input autoComplete="off" placeholder="e.g. 2106 or 9963" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormDescription>Used for GST-ready receipts and tax exports.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="emoji"
                    render={({ field }) => {
                      // A suggested (or previously saved) emoji outside the starter
                      // grid still needs a visible, selected button.
                      const options: string[] =
                        field.value && !(FOOD_EMOJIS as readonly string[]).includes(field.value)
                          ? [field.value, ...FOOD_EMOJIS]
                          : [...FOOD_EMOJIS];
                      return (
                        <FormItem>
                          <FormLabel>Emoji</FormLabel>
                          <FormControl>
                            <div
                              className="grid grid-cols-5 gap-2 sm:grid-cols-10"
                              role="group"
                              aria-label="Pick a food emoji"
                            >
                              {options.map((emo) => (
                                <button
                                  key={emo}
                                  type="button"
                                  className={`flex min-h-11 min-w-11 items-center justify-center rounded-md border text-lg transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                                    field.value === emo ? "border-primary bg-primary/10" : "border-input bg-background hover:bg-accent"
                                  }`}
                                  aria-pressed={field.value === emo}
                                  aria-label={`Select emoji ${emo}`}
                                  onClick={() => {
                                    setEmojiPicked(true);
                                    setEmojiSuggested(false);
                                    field.onChange(emo);
                                  }}
                                >
                                  {emo}
                                </button>
                              ))}
                            </div>
                          </FormControl>
                          {!isEdit && emojiSuggested ? (
                            <FormDescription>Picked from the name. Tap another to change it.</FormDescription>
                          ) : null}
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                </div>
              </div>
              <FormField
                control={form.control}
                name="isPopular"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    {/* The label is the 44px tap area; the box itself draws at 20px. */}
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                      <FormControl>
                        <input
                          type="checkbox"
                          id="isPopular"
                          className="h-5 w-5 shrink-0 cursor-pointer accent-primary"
                          checked={field.value ?? false}
                          onChange={field.onChange}
                          aria-label="Mark as popular"
                        />
                      </FormControl>
                      <span>Popular item</span>
                    </label>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isAvailable"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                      <FormControl>
                        <input
                          type="checkbox"
                          id="isAvailable"
                          className="h-5 w-5 shrink-0 cursor-pointer accent-primary"
                          checked={field.value ?? true}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <span>Selling now (untick when sold out)</span>
                    </label>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="showOnline"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <div className="flex flex-row items-center gap-3">
                      <ShowOnlineSwitch
                        id="showOnline"
                        checked={field.value ?? true}
                        onCheckedChange={field.onChange}
                        label="Show online"
                        describedBy="showOnline-help"
                      />
                      <span className="text-sm" aria-hidden="true">
                        Show online
                      </span>
                    </div>
                    <p id="showOnline-help" className="text-xs text-muted-foreground">
                      Off: sold at your counter only, hidden from your store page.
                    </p>
                  </FormItem>
                )}
              />
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter className="flex-row flex-wrap md:border-t md:py-4">
              {!isEdit ? (
                // Own row on phones, so the label never wraps beside Cancel / Create.
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 basis-full md:basis-auto"
                  disabled={isSubmitting}
                  onClick={form.handleSubmit((values) => save(values, true))}
                >
                  Save and add another
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="min-h-11 flex-1 md:flex-none"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="min-h-11 flex-1 md:flex-none" disabled={isSubmitting}>
                {isEdit ? "Save" : "Create"}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
