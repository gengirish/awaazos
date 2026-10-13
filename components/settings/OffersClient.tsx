"use client";

import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  formatPercentBps,
  normaliseTag,
  OFFER_DESCRIPTION_MAX,
  OFFER_MAX_BPS,
  OFFER_MAX_QTY,
  OFFER_MIN_BPS,
  OFFER_NAME_MAX,
  OFFER_TAG_MAX,
  type OfferEligibilityKind,
} from "@/lib/offers";
import type { OfferDto } from "@/lib/offers-server";
import { parsePercentInput, percentInputFromBps, type OfferUpsertBody } from "@/lib/zod-offers";
import { cn } from "@/lib/utils";

/**
 * Settings → Offers: the vendor's quantity plans ("4+ quiches incl. 1 paneer →
 * 10% off"). Saves through /api/offers; pricing itself lives in lib/offers.ts.
 */

export type OfferMenuItem = { id: string; name: string; tags: string[] };
export type OfferDrop = { id: string; title: string; dayLabel: string };

export type OffersClientProps = {
  initialOffers: OfferDto[];
  menuItems: OfferMenuItem[];
  drops: OfferDrop[];
  /** MANAGER or OWNER. Cashiers can read the list. */
  canEdit: boolean;
};

type FormState = {
  name: string;
  description: string;
  eligibility: OfferEligibilityKind;
  eligibleTag: string;
  eligibleItemIds: string[];
  minQty: string;
  requiredTag: string;
  requiredTagQty: string;
  percent: string;
  onMenuOrders: boolean;
  onDrops: boolean;
  onPos: boolean;
  dropIds: string[];
  startsOn: string;
  endsOn: string;
};

type FieldErrors = Partial<Record<keyof FormState | "where", string>>;

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  eligibility: "ALL",
  eligibleTag: "",
  eligibleItemIds: [],
  minQty: "",
  requiredTag: "",
  requiredTagQty: "",
  percent: "",
  onMenuOrders: true,
  onDrops: true,
  onPos: true,
  dropIds: [],
  startsOn: "",
  endsOn: "",
};

function toForm(o: OfferDto): FormState {
  return {
    name: o.name,
    description: o.description ?? "",
    eligibility: o.eligibility,
    eligibleTag: o.eligibleTag ?? "",
    eligibleItemIds: o.eligibleItemIds,
    minQty: String(o.minQty),
    requiredTag: o.requiredTag ?? "",
    requiredTagQty: o.requiredTagQty > 0 ? String(o.requiredTagQty) : "",
    percent: percentInputFromBps(o.percentBps),
    onMenuOrders: o.onMenuOrders,
    onDrops: o.onDrops,
    onPos: o.onPos,
    dropIds: o.dropIds,
    startsOn: o.startsOn ?? "",
    endsOn: o.endsOn ?? "",
  };
}

function parseQty(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= OFFER_MAX_QTY ? n : null;
}

/** Form → request body, or the errors that stop it. Mirrors `offerUpsertSchema`. */
function validate(f: FormState): { body: OfferUpsertBody } | { errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Give the offer a name";

  const minQty = parseQty(f.minQty);
  if (minQty === null) errors.minQty = `Enter a number from 1 to ${OFFER_MAX_QTY}`;

  const percentBps = parsePercentInput(f.percent);
  if (percentBps === null || percentBps < OFFER_MIN_BPS || percentBps > OFFER_MAX_BPS) {
    errors.percent = "Enter a percentage from 1 to 90";
  }

  if (f.eligibility === "TAG" && !normaliseTag(f.eligibleTag)) errors.eligibleTag = "Enter the tag these items carry";
  if (f.eligibility === "ITEMS" && f.eligibleItemIds.length === 0) errors.eligibleItemIds = "Pick at least one item";

  const requiredTag = normaliseTag(f.requiredTag);
  let requiredTagQty = 0;
  if (requiredTag) {
    const q = parseQty(f.requiredTagQty);
    if (q === null) errors.requiredTagQty = "Enter how many are needed";
    else if (minQty !== null && q > minQty) errors.requiredTagQty = "This is more than the minimum quantity";
    else requiredTagQty = q;
  } else if (f.requiredTagQty.trim()) {
    errors.requiredTag = "Enter the tag that is required";
  }

  if (!f.onMenuOrders && !f.onDrops && !f.onPos) errors.where = "Choose at least one place";
  if (f.startsOn && f.endsOn && f.endsOn < f.startsOn) errors.endsOn = "End date is before the start date";

  if (Object.keys(errors).length > 0 || minQty === null || percentBps === null) return { errors };
  return {
    body: {
      name,
      description: f.description.trim() || null,
      eligibility: f.eligibility,
      eligibleItemIds: f.eligibility === "ITEMS" ? f.eligibleItemIds : [],
      eligibleTag: f.eligibility === "TAG" ? f.eligibleTag : null,
      minQty,
      requiredTag: requiredTag || null,
      requiredTagQty,
      discountType: "PERCENT",
      percentBps,
      onMenuOrders: f.onMenuOrders,
      onDrops: f.onDrops,
      onPos: f.onPos,
      dropIds: f.onDrops ? f.dropIds : [],
      startsOn: f.startsOn || null,
      endsOn: f.endsOn || null,
    },
  };
}

const API_ERRORS: Record<string, string> = {
  unknown_items: "One of the chosen items is no longer on your menu. Pick the items again.",
  unknown_drops: "One of the chosen drops no longer exists. Pick the drops again.",
  offer_limit_reached: "You have reached the limit of 20 offers. Delete one you no longer use.",
};

function describeOffer(o: OfferDto, itemCount: number): string {
  const what =
    o.eligibility === "TAG"
      ? `items tagged "${o.eligibleTag}"`
      : o.eligibility === "ITEMS"
        ? `${itemCount} chosen ${itemCount === 1 ? "item" : "items"}`
        : "any items";
  const incl = o.requiredTag && o.requiredTagQty > 0 ? `, including ${o.requiredTagQty} tagged "${o.requiredTag}"` : "";
  return `${formatPercentBps(o.percentBps)} off ${o.minQty} or more ${what}${incl}`;
}

function whereLabel(o: OfferDto): string {
  const parts = [
    o.onMenuOrders ? "Online menu" : null,
    o.onDrops ? (o.dropIds.length > 0 ? `${o.dropIds.length} chosen ${o.dropIds.length === 1 ? "drop" : "drops"}` : "Drops") : null,
    o.onPos ? "Counter" : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** "13/10/2026" from a stored YYYY-MM-DD day. */
function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function datesLabel(o: OfferDto): string | null {
  if (o.startsOn && o.endsOn) return `${dayLabel(o.startsOn)} to ${dayLabel(o.endsOn)}`;
  if (o.startsOn) return `From ${dayLabel(o.startsOn)}`;
  if (o.endsOn) return `Until ${dayLabel(o.endsOn)}`;
  return null;
}

const CHECK_ROW = "flex min-h-11 cursor-pointer items-center gap-3 text-sm";
const CHECKBOX = "h-5 w-5 shrink-0 accent-[hsl(var(--primary))]";
const SELECT =
  "touch-target flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

export function OffersClient({ initialOffers, menuItems, drops, canEdit }: OffersClientProps) {
  const router = useRouter();
  const ids = useId();
  const [offers, setOffers] = useState(initialOffers);
  const [pending, startTransition] = useTransition();

  // `editing` outlives `open` so the sheet's title holds still while it closes.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OfferDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; offer: OfferDto | null }>({
    open: false,
    offer: null,
  });

  const knownTags = Array.from(new Set(menuItems.flatMap((m) => m.tags.map(normaliseTag)).filter(Boolean))).sort();
  const tagListId = `${ids}-tags`;
  const fid = (name: string) => `${ids}-${name}`;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleIn(key: "eligibleItemIds" | "dropIds", id: string, on: boolean) {
    setForm((f) => ({ ...f, [key]: on ? [...f[key], id] : f[key].filter((x) => x !== id) }));
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  function openEdit(o: OfferDto) {
    setEditing(o);
    setForm(toForm(o));
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    try {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: OfferDto; error?: string };
      if (res.ok) return { ok: true as const, data: json.data ?? null };
      if (res.status === 403) return { ok: false as const, message: "Only a manager or the owner can change offers." };
      return {
        ok: false as const,
        message: API_ERRORS[json.error ?? ""] ?? "Could not save. Check the details and try again.",
      };
    } catch {
      return { ok: false as const, message: "Network error. Please try again." };
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const result = validate(form);
    if ("errors" in result) {
      setErrors(result.errors);
      setFormError("Some details need a second look.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const res = editing
        ? await send(`/api/offers/${editing.id}`, "PATCH", { ...result.body, isActive: editing.isActive })
        : await send("/api/offers", "POST", result.body);
      if (!res.ok) {
        setFormError(res.message);
        return;
      }
      const saved = res.data;
      if (saved) {
        setOffers((list) => (editing ? list.map((o) => (o.id === saved.id ? saved : o)) : [...list, saved]));
      }
      toast.success(editing ? "Offer updated" : "Offer created");
      setOpen(false);
      router.refresh();
    });
  }

  function toggleActive(o: OfferDto) {
    if (pending) return;
    startTransition(async () => {
      const res = await send(`/api/offers/${o.id}`, "PATCH", { isActive: !o.isActive });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOffers((list) => list.map((x) => (x.id === o.id ? { ...x, isActive: !o.isActive } : x)));
      toast.success(o.isActive ? `${o.name} is off` : `${o.name} is on`);
    });
  }

  function deleteNow(o: OfferDto) {
    startTransition(async () => {
      const res = await send(`/api/offers/${o.id}`, "DELETE");
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOffers((list) => list.filter((x) => x.id !== o.id));
      toast.success("Offer deleted");
    });
  }

  const err = (key: keyof FieldErrors) =>
    errors[key] ? (
      <p id={fid(`${key}-error`)} className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null;
  const errProps = (key: keyof FieldErrors) =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": fid(`${key}-error`) } : {};

  return (
    <div className="space-y-4">
      {offers.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No offers yet"
          description="Reward bigger orders, for example 10% off 4 or more quiches."
          action={
            canEdit ? (
              <Button type="button" className="h-11" onClick={openCreate}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                New offer
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {offers.map((o) => {
              const dates = datesLabel(o);
              return (
                <li key={o.id} className="flex flex-wrap items-start gap-3 p-4">
                  <div className="min-w-0 flex-1 basis-56 space-y-1">
                    <p className="font-semibold text-foreground">
                      {o.name}{" "}
                      <span className="font-normal text-muted-foreground">· {o.isActive ? "On" : "Off"}</span>
                    </p>
                    <p className="text-sm text-foreground">{describeOffer(o, o.eligibleItemIds.length)}</p>
                    <p className="text-xs text-muted-foreground">
                      {whereLabel(o)}
                      {dates ? ` · ${dates}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={o.isActive}
                      aria-label={`${o.name} active`}
                      disabled={!canEdit || pending}
                      onClick={() => toggleActive(o)}
                      className="inline-flex min-h-11 min-w-14 items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "relative inline-flex h-7 w-12 items-center rounded-full transition-colors",
                          o.isActive ? "bg-primary" : "bg-input",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform motion-reduce:transition-none",
                            o.isActive ? "translate-x-6" : "translate-x-1",
                          )}
                        />
                      </span>
                    </button>
                    {canEdit ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${o.name}`}
                          onClick={() => openEdit(o)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Delete ${o.name}`}
                          onClick={() => setConfirmDelete({ open: true, offer: o })}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {canEdit ? (
            <Button type="button" variant="outline" className="h-11" onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              New offer
            </Button>
          ) : null}
        </>
      )}

      {!canEdit ? (
        <p className="text-sm text-muted-foreground">Only a manager or the owner can change offers.</p>
      ) : null}

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{editing ? "Edit offer" : "New offer"}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                A percentage off when one order has enough of the right items. Only one offer applies to an order.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody>
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor={fid("name")}>Name</Label>
                  <Input
                    id={fid("name")}
                    value={form.name}
                    maxLength={OFFER_NAME_MAX}
                    placeholder="Weekly Plan"
                    autoComplete="off"
                    onChange={(e) => set("name", e.target.value)}
                    {...errProps("name")}
                  />
                  {err("name")}
                </div>

                <div className="space-y-2">
                  <Label htmlFor={fid("description")}>Short description (customers see this)</Label>
                  <Input
                    id={fid("description")}
                    value={form.description}
                    maxLength={OFFER_DESCRIPTION_MAX}
                    placeholder="Mix any flavours, at least one paneer"
                    autoComplete="off"
                    onChange={(e) => set("description", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={fid("eligibility")}>Which items count</Label>
                  <select
                    id={fid("eligibility")}
                    className={SELECT}
                    value={form.eligibility}
                    onChange={(e) => set("eligibility", e.target.value as OfferEligibilityKind)}
                  >
                    <option value="ALL">All items</option>
                    <option value="TAG">Items with a tag</option>
                    <option value="ITEMS">Items I choose</option>
                  </select>
                </div>

                {form.eligibility === "TAG" ? (
                  <div className="space-y-2">
                    <Label htmlFor={fid("eligibleTag")}>Tag</Label>
                    <Input
                      id={fid("eligibleTag")}
                      value={form.eligibleTag}
                      maxLength={OFFER_TAG_MAX}
                      list={tagListId}
                      placeholder="quiche"
                      autoCapitalize="none"
                      autoComplete="off"
                      onChange={(e) => set("eligibleTag", e.target.value)}
                      {...errProps("eligibleTag")}
                    />
                    <p className="text-xs text-muted-foreground">
                      Add tags to items on the Menu page (Edit item → Tags).
                    </p>
                    {err("eligibleTag")}
                  </div>
                ) : null}

                {form.eligibility === "ITEMS" ? (
                  <fieldset className="space-y-1" {...errProps("eligibleItemIds")}>
                    <legend className="text-sm font-medium">Items</legend>
                    {menuItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Add items to your menu first.</p>
                    ) : (
                      <div className="max-h-56 overflow-y-auto rounded-md border px-3">
                        {menuItems.map((m) => (
                          <label key={m.id} className={CHECK_ROW}>
                            <input
                              type="checkbox"
                              className={CHECKBOX}
                              checked={form.eligibleItemIds.includes(m.id)}
                              onChange={(e) => toggleIn("eligibleItemIds", m.id, e.target.checked)}
                            />
                            <span className="min-w-0 break-words">{m.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {err("eligibleItemIds")}
                  </fieldset>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={fid("minQty")}>Minimum quantity</Label>
                    <Input
                      id={fid("minQty")}
                      value={form.minQty}
                      inputMode="numeric"
                      placeholder="4"
                      autoComplete="off"
                      onChange={(e) => set("minQty", e.target.value)}
                      {...errProps("minQty")}
                    />
                    {err("minQty")}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={fid("percent")}>Discount (%)</Label>
                    <Input
                      id={fid("percent")}
                      value={form.percent}
                      inputMode="decimal"
                      placeholder="10"
                      autoComplete="off"
                      onChange={(e) => set("percent", e.target.value)}
                      {...errProps("percent")}
                    />
                    {err("percent")}
                  </div>
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Must include (optional)</legend>
                  <p className="text-xs text-muted-foreground">
                    For example, at least 1 item tagged paneer among the items that count.
                  </p>
                  <div className="grid grid-cols-[minmax(0,5rem)_minmax(0,1fr)] gap-3">
                    <div className="space-y-2">
                      <Label htmlFor={fid("requiredTagQty")}>At least</Label>
                      <Input
                        id={fid("requiredTagQty")}
                        value={form.requiredTagQty}
                        inputMode="numeric"
                        placeholder="1"
                        autoComplete="off"
                        onChange={(e) => set("requiredTagQty", e.target.value)}
                        {...errProps("requiredTagQty")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={fid("requiredTag")}>Items tagged</Label>
                      <Input
                        id={fid("requiredTag")}
                        value={form.requiredTag}
                        maxLength={OFFER_TAG_MAX}
                        list={tagListId}
                        placeholder="paneer"
                        autoCapitalize="none"
                        autoComplete="off"
                        onChange={(e) => set("requiredTag", e.target.value)}
                        {...errProps("requiredTag")}
                      />
                    </div>
                  </div>
                  {err("requiredTagQty")}
                  {err("requiredTag")}
                </fieldset>

                <fieldset {...errProps("where")}>
                  <legend className="text-sm font-medium">Where it applies</legend>
                  <label className={CHECK_ROW}>
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      checked={form.onMenuOrders}
                      onChange={(e) => set("onMenuOrders", e.target.checked)}
                    />
                    Online store, everyday menu
                  </label>
                  <label className={CHECK_ROW}>
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      checked={form.onDrops}
                      onChange={(e) => set("onDrops", e.target.checked)}
                    />
                    Drops (pre-orders)
                  </label>
                  <label className={CHECK_ROW}>
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      checked={form.onPos}
                      onChange={(e) => set("onPos", e.target.checked)}
                    />
                    Counter (POS)
                  </label>
                  {err("where")}
                </fieldset>

                {form.onDrops && drops.length > 0 ? (
                  <fieldset className="space-y-1">
                    <legend className="text-sm font-medium">Only on these drops (optional)</legend>
                    <p className="text-xs text-muted-foreground">Leave all unticked to use it on every drop.</p>
                    <div className="max-h-44 overflow-y-auto rounded-md border px-3">
                      {drops.map((d) => (
                        <label key={d.id} className={CHECK_ROW}>
                          <input
                            type="checkbox"
                            className={CHECKBOX}
                            checked={form.dropIds.includes(d.id)}
                            onChange={(e) => toggleIn("dropIds", d.id, e.target.checked)}
                          />
                          <span className="min-w-0 break-words">
                            {d.title} <span className="text-muted-foreground">· {d.dayLabel}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={fid("startsOn")}>Starts (optional)</Label>
                    <Input
                      id={fid("startsOn")}
                      type="date"
                      value={form.startsOn}
                      onChange={(e) => set("startsOn", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={fid("endsOn")}>Ends (optional)</Label>
                    <Input
                      id={fid("endsOn")}
                      type="date"
                      value={form.endsOn}
                      onChange={(e) => set("endsOn", e.target.value)}
                      {...errProps("endsOn")}
                    />
                  </div>
                </div>
                {err("endsOn")}

                <datalist id={tagListId}>
                  {knownTags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>

                <div role="alert" aria-atomic="true">
                  {formError ? <p className="text-sm font-medium text-destructive">{formError}</p> : null}
                </div>
              </div>
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {editing ? "Save changes" : "Create offer"}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ConfirmDialog
        open={confirmDelete.open}
        onOpenChange={(o) => setConfirmDelete((c) => ({ ...c, open: o }))}
        title={`Delete ${confirmDelete.offer?.name ?? "this offer"}?`}
        description="New orders will no longer get this discount. Past bills keep it."
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDelete.offer) deleteNow(confirmDelete.offer);
        }}
      />
    </div>
  );
}
