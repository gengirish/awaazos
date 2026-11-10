"use client";

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
import { Switch } from "@/components/ui/switch";
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
import { parseStockInput, type MenuRow, type MenuStockFields } from "@/lib/menu-stock";
import { suggestEmoji } from "@/lib/menu-suggestions";
import { isValidMenuUnit, MENU_UNIT_MAX, MENU_UNIT_MESSAGE, normaliseMenuUnit } from "@/lib/menu-unit";
import { categoryOptions, paiseToRupeeInput, parseRupeeInput } from "@/lib/menu-voice";
import { vocabularyForKind, type StoreVocabulary } from "@/lib/store-vocabulary";
import { cn } from "@/lib/utils";
import { MENU_DESCRIPTION_MAX, menuItemCreateInputSchema, menuItemUpdateSchema } from "@/lib/zod-menu";

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

/** The starter grid for a store that doesn't sell food (lib/store-vocabulary.ts). */
export const GOODS_EMOJIS = [
  "🛍️",
  "📦",
  "🎁",
  "🌿",
  "🍃",
  "🌸",
  "🫙",
  "🍯",
  "🫖",
  "🧴",
  "🧼",
  "💊",
  "🕯️",
  "🪔",
  "🧘",
  "💆",
  "👕",
  "👜",
  "💍",
  "✨",
] as const;

const DEFAULT_EMOJI = "🍽️";
const DEFAULT_GOODS_EMOJI = "🛍️";

/** The emoji grid this store is offered. */
export function emojiChoices(vocab: StoreVocabulary): readonly string[] {
  return vocab.foodArt ? FOOD_EMOJIS : GOODS_EMOJIS;
}

/** The emoji a new row gets when nothing suggests one. */
export function defaultEmoji(vocab: StoreVocabulary): string {
  return vocab.foodArt ? DEFAULT_EMOJI : DEFAULT_GOODS_EMOJI;
}

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
  // The typed text; normalised (blank → null) on submit, same rule as the API.
  unit: z
    .string()
    .optional()
    .refine((value) => {
      const unit = normaliseMenuUnit(value);
      return unit === null || isValidMenuUnit(unit);
    }, MENU_UNIT_MESSAGE),
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
  unit: "",
  description: "",
};

type MenuItemFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: MenuRow | null;
  onSaved: () => void;
  /** Create only: pre-fill the name (e.g. a dish heard by the voice drop builder). */
  defaultName?: string;
  /** Categories already on this vendor's menu, offered as suggestions. */
  categories?: readonly string[];
  /** The store's words (lib/store-vocabulary.ts); a kitchen when not given. */
  vocab?: StoreVocabulary;
};

const FOOD_VOCAB = vocabularyForKind("food");

const NO_CATEGORIES: readonly string[] = [];

/** "In stock now" as first shown: what is left (never below 0), or blank when untracked. */
function initialStockText(item: MenuRow | null): string {
  if (!item || item.stockQty === null) return "";
  return String(Math.max(0, item.stockLeft ?? item.stockQty));
}

export function MenuItemForm({
  open,
  onOpenChange,
  item,
  onSaved,
  defaultName = "",
  categories = NO_CATEGORIES,
  vocab = FOOD_VOCAB,
}: MenuItemFormProps) {
  const baseEmoji = defaultEmoji(vocab);
  const starterEmojis = emojiChoices(vocab);
  const itemNoun = vocab.kind === "food" ? "Menu item" : vocab.Item;
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
  // Stock (lib/menu-stock.ts) sits beside the RHF fields: a count is only sent
  // when the seller changes it, since sending one records a fresh count.
  const [trackStock, setTrackStock] = useState(false);
  const [stockText, setStockText] = useState("");
  const [lowText, setLowText] = useState("");
  const [stockError, setStockError] = useState<{ field: "stock" | "low"; message: string } | null>(null);
  const stockInputRef = useRef<HTMLInputElement>(null);
  const lowInputRef = useRef<HTMLInputElement>(null);

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
    setTrackStock(item?.stockQty != null);
    setStockText(initialStockText(item));
    setLowText(item?.lowStockAt != null ? String(item.lowStockAt) : "");
    setStockError(null);
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
        unit: item.unit ?? "",
        description: item.description ?? "",
      });
    } else {
      const suggestion = defaultName ? suggestEmoji(defaultName) : null;
      form.reset({
        ...defaultCreateValues,
        name: defaultName,
        emoji: suggestion ?? baseEmoji,
      });
      setEmojiSuggested(suggestion !== null);
    }
  }, [open, item, form, defaultName, baseEmoji]);

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

  /** The stock keys to send, or null after showing an error on the field. */
  function stockBody(): MenuStockFields | null {
    const wasTracked = item?.stockQty != null;
    if (!trackStock) return wasTracked ? { stockQty: null } : {};
    const count = parseStockInput(stockText);
    if ("error" in count || count.value === null) {
      setStockError({ field: "stock", message: "error" in count ? count.error : "Enter how many you have" });
      stockInputRef.current?.focus();
      return null;
    }
    const low = parseStockInput(lowText);
    if ("error" in low) {
      setStockError({ field: "low", message: low.error });
      lowInputRef.current?.focus();
      return null;
    }
    const out: MenuStockFields = {};
    if (!wasTracked || stockText.trim() !== initialStockText(item)) out.stockQty = count.value;
    if (low.value !== (item?.lowStockAt ?? null)) out.lowStockAt = low.value;
    return out;
  }

  /** `addAnother` (create only): keep the sheet open, cleared, for the next item. */
  async function save(values: MenuItemFormValues, addAnother: boolean) {
    const price = parseRupeeInput(values.priceInRupees);
    if ("error" in price) {
      form.setError("priceInRupees", { message: price.error }, { shouldFocus: true });
      return;
    }
    const stock = stockBody();
    if (!stock) return;
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
      unit: normaliseMenuUnit(values.unit),
      description: values.description ?? "",
    };
    try {
      if (isEdit && item) {
        const body = menuItemUpdateSchema.parse({ ...fields, hsnCode: values.hsnCode?.trim() || null });
        const res = await fetch(`/api/menu/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, ...stock }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(typeof json.error === "string" ? json.error : "Could not update item");
          return;
        }
        toast.success(`${itemNoun} updated`);
      } else {
        const res = await fetch("/api/menu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...fields, hsnCode: values.hsnCode ?? "", ...stock }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(typeof json.error === "string" ? json.error : "Could not create item");
          return;
        }
        toast.success(addAnother ? `${values.name} added. Add the next one.` : `${itemNoun} created`);
        // The item exists now, so the held photo finally has an id to attach to.
        // A failed upload has already toasted; the item itself is still saved.
        if (pendingFile && typeof json?.data?.id === "string") {
          await uploadImage(json.data.id, pendingFile);
        }
        if (addAnother) {
          // Same category again: sellers add a whole section in one go.
          form.reset({ ...defaultCreateValues, emoji: baseEmoji, category: values.category?.trim() ?? "" });
          setPendingFile(null);
          setEmojiPicked(false);
          setEmojiSuggested(false);
          setMoreOpen(false);
          setTrackStock(false);
          setStockText("");
          setLowText("");
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
          <ResponsiveDialogTitle id="menu-item-form-title">{isEdit ? "Edit item" : `Add ${itemNoun.toLowerCase()}`}</ResponsiveDialogTitle>
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
                        placeholder={vocab.kind === "food" ? "e.g. Bhel puri" : "e.g. Ashwagandha powder"}
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          if (isEdit || emojiPicked) return;
                          const suggestion = suggestEmoji(e.target.value);
                          form.setValue("emoji", suggestion ?? baseEmoji);
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
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl>
                      <textarea
                        rows={2}
                        maxLength={MENU_DESCRIPTION_MAX}
                        placeholder={
                          vocab.kind === "food"
                            ? "e.g. Soft idlis with coconut chutney, 4 per plate"
                            : "e.g. 8 mm Karungali beads, 108 count"
                        }
                        className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      One line under the name on your store page. {(field.value ?? "").length}/{MENU_DESCRIPTION_MAX}
                    </FormDescription>
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
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{vocab.kind === "food" ? "Unit (optional)" : "Pack size (optional)"}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="off"
                        maxLength={MENU_UNIT_MAX}
                        placeholder={vocab.kind === "food" ? "e.g. kg, piece, box" : "e.g. 100 g, 60 capsules, 500 ml"}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Shown after the price on your store page, like {vocab.kind === "food" ? "₹1,200 / kg" : "₹399 / 100 g"}.
                    </FormDescription>
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
                    <FormDescription>
                      Pick one or type your own, like {vocab.kind === "food" ? "Cakes or Thalis" : "Herbal teas or Oils"}.
                    </FormDescription>
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
                            placeholder={vocab.kind === "food" ? "bhel, spicy bhel" : "ashwagandha, ashwa powder"}
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
                            placeholder={vocab.kind === "food" ? "quiche, paneer" : "herbal, gift"}
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormDescription>
                          Comma-separated labels of your own. Offers use them to pick items, for example
                          10% off 4 or more items tagged {vocab.kind === "food" ? "quiche" : "herbal"}.
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
                        field.value && !starterEmojis.includes(field.value)
                          ? [field.value, ...starterEmojis]
                          : [...starterEmojis];
                      return (
                        <FormItem>
                          <FormLabel>Emoji</FormLabel>
                          <FormControl>
                            <div
                              className="grid grid-cols-5 gap-2 sm:grid-cols-10"
                              role="group"
                              aria-label={vocab.foodArt ? "Pick a food emoji" : "Pick an emoji"}
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
                    <div className="flex items-center gap-3">
                      <Switch id="isPopular" checked={field.value ?? false} onCheckedChange={field.onChange} />
                      <label htmlFor="isPopular" className="cursor-pointer text-sm">
                        Popular item
                      </label>
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isAvailable"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <div className="flex items-center gap-3">
                      <Switch
                        id="isAvailable"
                        checked={field.value ?? true}
                        onCheckedChange={field.onChange}
                        aria-describedby="isAvailable-help"
                      />
                      <label htmlFor="isAvailable" className="cursor-pointer text-sm">
                        Selling now
                      </label>
                    </div>
                    <p id="isAvailable-help" className="text-xs text-muted-foreground">
                      Off: shown as sold out.
                    </p>
                  </FormItem>
                )}
              />
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <Switch
                      id="trackStock"
                      checked={trackStock}
                      onCheckedChange={(on) => {
                        setTrackStock(on);
                        setStockError(null);
                      }}
                      aria-describedby="trackStock-help"
                    />
                    <label htmlFor="trackStock" className="cursor-pointer text-sm">
                      Track stock
                    </label>
                  </div>
                  <p id="trackStock-help" className="text-xs text-muted-foreground">
                    {trackStock
                      ? `Every sale takes one off. Online orders stop when this ${vocab.item} runs out.`
                      : `Off: no count kept for this ${vocab.item}.`}
                  </p>
                </div>
                {trackStock ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor="stockQty" className="block text-sm font-medium">
                        In stock now
                      </label>
                      <Input
                        ref={stockInputRef}
                        id="stockQty"
                        inputMode="numeric"
                        autoComplete="off"
                        value={stockText}
                        aria-invalid={stockError?.field === "stock" ? true : undefined}
                        aria-describedby={stockError?.field === "stock" ? "stockQty-error" : undefined}
                        onChange={(e) => {
                          setStockText(e.target.value);
                          setStockError(null);
                        }}
                      />
                      {stockError?.field === "stock" ? (
                        <p id="stockQty-error" className="text-xs text-destructive">
                          {stockError.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="lowStockAt" className="block text-sm font-medium">
                        Warn me when this many are left (optional)
                      </label>
                      <Input
                        ref={lowInputRef}
                        id="lowStockAt"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="e.g. 3"
                        value={lowText}
                        aria-invalid={stockError?.field === "low" ? true : undefined}
                        aria-describedby={stockError?.field === "low" ? "lowStockAt-error" : undefined}
                        onChange={(e) => {
                          setLowText(e.target.value);
                          setStockError(null);
                        }}
                      />
                      {stockError?.field === "low" ? (
                        <p id="lowStockAt-error" className="text-xs text-destructive">
                          {stockError.message}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <FormField
                control={form.control}
                name="showOnline"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <div className="flex flex-row items-center gap-3">
                      <Switch
                        id="showOnline"
                        checked={field.value ?? true}
                        onCheckedChange={field.onChange}
                        aria-describedby="showOnline-help"
                      />
                      <label htmlFor="showOnline" className="cursor-pointer text-sm">
                        Show online
                      </label>
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
