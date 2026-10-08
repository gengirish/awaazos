"use client";

import type { DropStatus } from "@prisma/client";
import { AlertTriangle, Copy, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR, paiseToRupees, rupeesToPaise } from "@/lib/currency";
import type { EffectiveDropStatus } from "@/lib/drops";
import {
  DROP_CONFLICT_MESSAGE,
  DROP_STATUS_LABEL,
  PER_ORDER_OVER_MAX,
  cutoffLeadDays,
  isValidYmd,
  istTomorrowYmd,
  shiftOrderWindowDates,
} from "@/lib/drops-builder";
import { formatDropDayLabel, formatIstDate, ymdToDbDate } from "@/lib/drops-time";
import type { DropUpsertInput } from "@/lib/zod-drops";

// ─── Shared bits ────────────────────────────────────────────────────

const inputCls =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive";

type Issue = { path: (string | number)[]; message: string };
type ApiError = { error?: string; issues?: Issue[]; menuItemId?: string };

function ymdHint(ymd: string): string {
  try {
    const d = ymdToDbDate(ymd);
    return `${formatDropDayLabel(d)} · ${formatIstDate(d)}`;
  } catch {
    return "";
  }
}

function paiseToInput(paise: number): string {
  return String(paiseToRupees(paise));
}

/** "120" / "12.50" → paise, or null if it isn't a valid rupee amount. */
function rupeeInputToPaise(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  try {
    return rupeesToPaise(Number(t));
  } catch {
    return null;
  }
}

/** "" → null (unlimited), "12" → 12, anything else → undefined (invalid). */
function countInput(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d{1,5}$/.test(t)) return undefined;
  const n = Number(t);
  return n > 0 ? n : undefined;
}

function conflictMessage(body: ApiError, fallback: string): string {
  return (body.error && DROP_CONFLICT_MESSAGE[body.error]) || body.error || fallback;
}

/** Link to the setting that fixes a given 409, if there is one. */
function ConflictFix({ code }: { code: string | null }) {
  if (code === "storefront_not_published") {
    return (
      <Link href="/settings/store" className="font-semibold underline underline-offset-2">
        Open Online store settings to publish it
      </Link>
    );
  }
  if (code === "no_payment_method") {
    return (
      <Link href="/settings/payments" className="font-semibold underline underline-offset-2">
        Open payment settings
      </Link>
    );
  }
  return null;
}

/**
 * "Orders close N days before cooking day". More than a day ahead is allowed
 * but unusual (often a cooking day moved without its cut-off), so it gets a
 * soft warning — icon + text, not colour alone. Never blocks saving.
 */
function CutoffLeadHint({ id, days }: { id: string; days: number | null }) {
  if (days === null || days < 0) return null;
  if (days === 0) {
    return (
      <p id={id} className="text-xs text-muted-foreground">
        Orders close on the cooking day.
      </p>
    );
  }
  const text = `Orders close ${days} ${days === 1 ? "day" : "days"} before cooking day.`;
  if (days === 1) {
    return (
      <p id={id} className="text-xs text-muted-foreground">
        {text}
      </p>
    );
  }
  return (
    <p
      id={id}
      className="flex items-start gap-1.5 rounded-md border border-amber-500/50 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {text} Customers can&apos;t order after that — check this is what you meant.
      </span>
    </p>
  );
}

// ─── Form ───────────────────────────────────────────────────────────

export type DropFormMenuItem = {
  id: string;
  name: string;
  emoji: string;
  priceInPaise: number;
  isAvailable: boolean;
};

type Row = { selected: boolean; price: string; maxQty: string; perOrderLimit: string };

type FormState = {
  title: string;
  note: string;
  date: string;
  fulfilmentMode: DropUpsertInput["fulfilmentMode"];
  fulfilmentStart: string;
  fulfilmentEnd: string;
  deliveryFee: string;
  pickupNote: string;
  closesAtDate: string;
  closesAtTime: string;
  useOpensAt: boolean;
  opensAtDate: string;
  opensAtTime: string;
  showEverydayMenu: boolean;
};

export type DropFormProps = {
  menuItems: DropFormMenuItem[];
  initial: DropUpsertInput;
  /** Absent = create. */
  dropId?: string;
  /** Frozen / fulfilled drops are read-only. */
  locked?: boolean;
  /** menuItemId → qty already reserved by buyers (edit only). */
  soldByMenuItem?: Record<string, number>;
};

const MODES: { value: FormState["fulfilmentMode"]; label: string }[] = [
  { value: "DELIVERY", label: "Delivery" },
  { value: "PICKUP", label: "Pickup" },
  { value: "BOTH", label: "Both" },
];

export function DropForm({ menuItems, initial, dropId, locked = false, soldByMenuItem = {} }: DropFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(() => ({
    title: initial.title,
    note: initial.note ?? "",
    date: initial.date,
    fulfilmentMode: initial.fulfilmentMode,
    fulfilmentStart: initial.fulfilmentStart,
    fulfilmentEnd: initial.fulfilmentEnd,
    deliveryFee: paiseToInput(initial.deliveryFeePaise ?? 0),
    pickupNote: initial.pickupNote ?? "",
    closesAtDate: initial.closesAtDate,
    closesAtTime: initial.closesAtTime,
    useOpensAt: Boolean(initial.opensAtDate && initial.opensAtTime),
    opensAtDate: initial.opensAtDate ?? initial.closesAtDate,
    opensAtTime: initial.opensAtTime ?? "09:00",
    showEverydayMenu: initial.showEverydayMenu ?? false,
  }));

  // Drop items first (in their saved order), then the rest of the menu.
  const order = useMemo(() => {
    const inDrop = initial.items.map((i) => i.menuItemId);
    const seen = new Set(inDrop);
    return [...inDrop, ...menuItems.map((m) => m.id).filter((id) => !seen.has(id))];
  }, [initial.items, menuItems]);

  const menuById = useMemo(() => new Map(menuItems.map((m) => [m.id, m])), [menuItems]);

  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const out: Record<string, Row> = {};
    for (const m of menuItems) {
      out[m.id] = { selected: false, price: paiseToInput(m.priceInPaise), maxQty: "", perOrderLimit: "" };
    }
    for (const i of initial.items) {
      out[i.menuItemId] = {
        selected: true,
        price: paiseToInput(i.priceInPaise),
        maxQty: i.maxQty == null ? "" : String(i.maxQty),
        perOrderLimit: i.perOrderLimit == null ? "" : String(i.perOrderLimit),
      };
    }
    return out;
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  };

  // Order-window dates follow the cooking day unless the vendor set them by
  // hand in this session. `lastCookingDate` survives the date input being
  // cleared mid-edit, so re-picking a day still shifts from the last real one.
  const touchedDates = useRef({ closesAtDate: false, opensAtDate: false });
  const lastCookingDate = useRef(initial.date);
  const setOrderWindowDate = (key: "closesAtDate" | "opensAtDate", value: string) => {
    touchedDates.current[key] = true;
    set(key, value);
  };
  const setCookingDate = (next: string) => {
    const prev = lastCookingDate.current;
    if (isValidYmd(next)) lastCookingDate.current = next;
    const touched = { ...touchedDates.current };
    setForm((f) => ({ ...shiftOrderWindowDates(f, prev, next, touched), date: next }));
    setFieldErrors((e) =>
      e.date || e.closesAtDate || e.closesAtTime || e.opensAtDate
        ? { ...e, date: "", closesAtDate: "", closesAtTime: "", opensAtDate: "" }
        : e,
    );
  };
  const leadDays = cutoffLeadDays(form.date, form.closesAtDate);
  const setRow = (id: string, patch: Partial<Row>) => {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
    setItemErrors((e) => (e[id] ? { ...e, [id]: "" } : e));
  };

  const selectedIds = order.filter((id) => rows[id]?.selected && menuById.has(id));
  const visibleIds = order.filter((id) => {
    const m = menuById.get(id);
    if (!m) return false;
    return !filter.trim() || m.name.toLowerCase().includes(filter.trim().toLowerCase());
  });

  function buildPayload(): DropUpsertInput | null {
    const fe: Record<string, string> = {};
    const ie: Record<string, string> = {};

    const deliveryFeePaise = form.fulfilmentMode === "PICKUP" ? 0 : rupeeInputToPaise(form.deliveryFee || "0");
    if (deliveryFeePaise === null) fe.deliveryFeePaise = "Enter the fee in rupees, e.g. 30";

    const items: DropUpsertInput["items"] = [];
    selectedIds.forEach((id, idx) => {
      const r = rows[id];
      const price = rupeeInputToPaise(r.price);
      const maxQty = countInput(r.maxQty);
      const perOrderLimit = countInput(r.perOrderLimit);
      if (price === null || price <= 0) ie[id] = "Enter a price in rupees, e.g. 120";
      else if (maxQty === undefined) ie[id] = "Quantity must be a whole number, or blank for no limit";
      else if (perOrderLimit === undefined) ie[id] = "Per-order limit must be a whole number, or blank";
      else if (maxQty !== null && perOrderLimit !== null && perOrderLimit > maxQty) ie[id] = PER_ORDER_OVER_MAX;
      else items.push({ menuItemId: id, priceInPaise: price, maxQty, perOrderLimit, sortOrder: idx });
    });
    if (selectedIds.length === 0) fe.items = "Pick at least one item for this drop";

    setFieldErrors(fe);
    setItemErrors(ie);
    if (Object.keys(fe).length || Object.keys(ie).length || deliveryFeePaise === null) return null;

    return {
      title: form.title.trim(),
      note: form.note.trim() || null,
      date: form.date,
      fulfilmentMode: form.fulfilmentMode,
      fulfilmentStart: form.fulfilmentStart,
      fulfilmentEnd: form.fulfilmentEnd,
      pickupNote: form.fulfilmentMode === "DELIVERY" ? null : form.pickupNote.trim() || null,
      deliveryFeePaise,
      opensAtDate: form.useOpensAt ? form.opensAtDate : null,
      opensAtTime: form.useOpensAt ? form.opensAtTime : null,
      closesAtDate: form.closesAtDate,
      closesAtTime: form.closesAtTime,
      showEverydayMenu: form.showEverydayMenu,
      items,
    };
  }

  function applyIssues(issues: Issue[], payload: DropUpsertInput) {
    const fe: Record<string, string> = {};
    const ie: Record<string, string> = {};
    for (const issue of issues) {
      const [head, idx] = issue.path;
      if (head === "items" && typeof idx === "number") {
        const id = payload.items[idx]?.menuItemId;
        if (id) ie[id] = issue.message;
      } else if (typeof head === "string") {
        fe[head] = fe[head] || issue.message;
      }
    }
    setFieldErrors(fe);
    setItemErrors(ie);
    if (!Object.keys(fe).length && !Object.keys(ie).length) setFormError("Please check the form and try again.");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || pending) return;
    setFormError(null);
    const payload = buildPayload();
    if (!payload) {
      setFormError("Some fields need fixing — see the messages below.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(dropId ? `/api/drops/${dropId}` : "/api/drops", {
          method: dropId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => ({}))) as ApiError & { data?: { id: string } };
        if (res.status === 400 && body.issues) {
          applyIssues(body.issues, payload);
          setFormError("Some fields need fixing — see the messages below.");
          return;
        }
        if (res.status === 409 && body.error === "item_has_orders" && body.menuItemId) {
          const name = menuById.get(body.menuItemId)?.name ?? "This item";
          setItemErrors({ [body.menuItemId]: DROP_CONFLICT_MESSAGE.item_has_orders });
          setFormError(`${name} already has orders, so it can't be removed from this drop.`);
          return;
        }
        if (!res.ok) {
          setFormError(conflictMessage(body, "Could not save this drop."));
          return;
        }
        if (dropId) {
          toast.success("Drop saved.");
          router.refresh();
        } else if (body.data?.id) {
          toast.success("Drop created. Open orders when you're ready.");
          router.push(`/drops/${body.data.id}/edit`);
        }
      } catch {
        setFormError("Network error — please try again.");
      }
    });
  }

  const err = (key: string) =>
    fieldErrors[key] ? (
      <p id={`${key}-error`} className="text-xs text-destructive">
        {fieldErrors[key]}
      </p>
    ) : null;
  const errProps = (key: string) =>
    fieldErrors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {};
  /** Error id (when shown) plus an always-present hint id. */
  const describedBy = (key: string, hintId: string | null) =>
    [fieldErrors[key] ? `${key}-error` : null, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <form onSubmit={submit} noValidate className="space-y-6" aria-busy={pending}>
      {locked ? (
        <p role="status" className="rounded-md border border-border bg-muted/50 p-3 text-sm">
          Orders are frozen, so this drop can&apos;t be edited any more.
        </p>
      ) : null}

      <fieldset disabled={locked || pending} className="space-y-6">
        {/* ── Basics ── */}
        <section aria-labelledby="drop-basics" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 id="drop-basics" className="font-display text-lg font-semibold">
            What are you cooking?
          </h2>
          <div className="space-y-1.5">
            <label htmlFor="drop-title" className="text-sm font-medium">
              Title
            </label>
            <input
              id="drop-title"
              className={inputCls}
              maxLength={80}
              placeholder="Saturday bakes"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              {...errProps("title")}
            />
            {err("title")}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="drop-note" className="text-sm font-medium">
              Note for customers <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="drop-note"
              className={`${inputCls} min-h-20 py-2`}
              maxLength={280}
              placeholder="Fresh eggless cakes, made to order"
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              {...errProps("note")}
            />
            {err("note")}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="drop-date" className="text-sm font-medium">
              Cooking day
            </label>
            <input
              id="drop-date"
              type="date"
              className={inputCls}
              value={form.date}
              onChange={(e) => setCookingDate(e.target.value)}
              {...errProps("date")}
            />
            <p className="text-xs text-muted-foreground">{ymdHint(form.date)}</p>
            {err("date")}
          </div>
        </section>

        {/* ── Fulfilment ── */}
        <section aria-labelledby="drop-fulfilment" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 id="drop-fulfilment" className="font-display text-lg font-semibold">
            Delivery or pickup
          </h2>
          <div role="radiogroup" aria-label="How customers get their food" className="grid grid-cols-3 gap-2">
            {MODES.map((m) => {
              const active = form.fulfilmentMode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set("fulfilmentMode", m.value)}
                  className={`min-h-11 rounded-md border px-2 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-accent"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="drop-start" className="text-sm font-medium">
                From
              </label>
              <input
                id="drop-start"
                type="time"
                className={inputCls}
                value={form.fulfilmentStart}
                onChange={(e) => set("fulfilmentStart", e.target.value)}
                {...errProps("fulfilmentStart")}
              />
              {err("fulfilmentStart")}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="drop-end" className="text-sm font-medium">
                Until
              </label>
              <input
                id="drop-end"
                type="time"
                className={inputCls}
                value={form.fulfilmentEnd}
                onChange={(e) => set("fulfilmentEnd", e.target.value)}
                {...errProps("fulfilmentEnd")}
              />
              {err("fulfilmentEnd")}
            </div>
          </div>
          {form.fulfilmentMode !== "PICKUP" ? (
            <div className="space-y-1.5">
              <label htmlFor="drop-fee" className="text-sm font-medium">
                Delivery fee (₹)
              </label>
              <input
                id="drop-fee"
                inputMode="decimal"
                className={inputCls}
                placeholder="0"
                value={form.deliveryFee}
                onChange={(e) => set("deliveryFee", e.target.value)}
                {...errProps("deliveryFeePaise")}
              />
              <p className="text-xs text-muted-foreground">Leave 0 for free delivery.</p>
              {err("deliveryFeePaise")}
            </div>
          ) : null}
          {form.fulfilmentMode !== "DELIVERY" ? (
            <div className="space-y-1.5">
              <label htmlFor="drop-pickup" className="text-sm font-medium">
                Pickup instructions <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="drop-pickup"
                className={inputCls}
                maxLength={200}
                placeholder="Collect from Gate 2, Block C"
                value={form.pickupNote}
                onChange={(e) => set("pickupNote", e.target.value)}
                {...errProps("pickupNote")}
              />
              {err("pickupNote")}
            </div>
          ) : null}
        </section>

        {/* ── Ordering window ── */}
        <section aria-labelledby="drop-window" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 id="drop-window" className="font-display text-lg font-semibold">
            When can customers order?
          </h2>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Last time to order</legend>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                aria-label="Order cut-off date"
                className={inputCls}
                value={form.closesAtDate}
                onChange={(e) => setOrderWindowDate("closesAtDate", e.target.value)}
                {...errProps("closesAtDate")}
                aria-describedby={describedBy("closesAtDate", leadDays !== null && leadDays >= 0 ? "cutoff-lead" : null)}
              />
              <input
                type="time"
                aria-label="Order cut-off time"
                className={inputCls}
                value={form.closesAtTime}
                onChange={(e) => set("closesAtTime", e.target.value)}
                {...errProps("closesAtTime")}
              />
            </div>
            <p className="text-xs text-muted-foreground">{ymdHint(form.closesAtDate)} (IST)</p>
            <CutoffLeadHint id="cutoff-lead" days={leadDays} />
            {err("closesAtDate")}
            {err("closesAtTime")}
          </fieldset>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              className="h-5 w-5 accent-primary"
              checked={form.useOpensAt}
              onChange={(e) => set("useOpensAt", e.target.checked)}
            />
            Start taking orders later, not as soon as I open the drop
          </label>
          {form.useOpensAt ? (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Orders open at</legend>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  aria-label="Orders open date"
                  className={inputCls}
                  value={form.opensAtDate}
                  onChange={(e) => setOrderWindowDate("opensAtDate", e.target.value)}
                  {...errProps("opensAtDate")}
                />
                <input
                  type="time"
                  aria-label="Orders open time"
                  className={inputCls}
                  value={form.opensAtTime}
                  onChange={(e) => set("opensAtTime", e.target.value)}
                  {...errProps("opensAtTime")}
                />
              </div>
              <p className="text-xs text-muted-foreground">{ymdHint(form.opensAtDate)} (IST)</p>
              {err("opensAtDate")}
              {err("opensAtTime")}
            </fieldset>
          ) : null}

          <div className="space-y-1">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-primary"
                checked={form.showEverydayMenu}
                onChange={(e) => set("showEverydayMenu", e.target.checked)}
                aria-describedby="drop-everyday-help"
              />
              Also show my everyday menu while this drop is open
            </label>
            <p id="drop-everyday-help" className="pl-8 text-xs text-muted-foreground">
              Off: customers see only this drop. On: your regular menu appears below it.
            </p>
          </div>
        </section>

        {/* ── Items ── */}
        <section aria-labelledby="drop-items" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="drop-items" className="font-display text-lg font-semibold">
              Items
            </h2>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {selectedIds.length} selected
            </p>
          </div>
          {err("items")}
          {menuItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Your menu is empty.{" "}
              <Link href="/menu" className="font-medium text-primary underline underline-offset-2">
                Add menu items
              </Link>{" "}
              first, then come back.
            </p>
          ) : (
            <>
              {menuItems.length > 10 ? (
                <input
                  type="search"
                  aria-label="Search menu items"
                  placeholder="Search your menu"
                  className={inputCls}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              ) : null}
              <ul className="space-y-3">
                {visibleIds.map((id) => {
                  const m = menuById.get(id)!;
                  const r = rows[id];
                  const sold = soldByMenuItem[id] ?? 0;
                  const errorId = `item-${id}-error`;
                  return (
                    <li
                      key={id}
                      className={`rounded-lg border p-3 ${r.selected ? "border-primary/60 bg-primary/5" : "border-border"}`}
                    >
                      <label className="flex min-h-11 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0 accent-primary"
                          checked={r.selected}
                          onChange={(e) => setRow(id, { selected: e.target.checked })}
                        />
                        <span aria-hidden="true" className="text-xl">
                          {m.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            Menu price {formatINR(m.priceInPaise)}
                            {!m.isAvailable ? " · hidden on menu" : ""}
                            {sold > 0 ? ` · ${sold} ordered` : ""}
                          </span>
                        </span>
                      </label>
                      {r.selected ? (
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <label htmlFor={`price-${id}`} className="text-xs font-medium">
                              Price (₹)
                            </label>
                            <input
                              id={`price-${id}`}
                              inputMode="decimal"
                              className={inputCls}
                              value={r.price}
                              onChange={(e) => setRow(id, { price: e.target.value })}
                              aria-invalid={itemErrors[id] ? true : undefined}
                              aria-describedby={itemErrors[id] ? errorId : undefined}
                            />
                          </div>
                          <div className="space-y-1">
                            <label htmlFor={`max-${id}`} className="text-xs font-medium">
                              How many can you make?
                            </label>
                            <input
                              id={`max-${id}`}
                              inputMode="numeric"
                              placeholder="No limit"
                              className={inputCls}
                              value={r.maxQty}
                              onChange={(e) => setRow(id, { maxQty: e.target.value })}
                              aria-invalid={itemErrors[id] ? true : undefined}
                              aria-describedby={itemErrors[id] ? errorId : undefined}
                            />
                          </div>
                          <div className="space-y-1">
                            <label htmlFor={`limit-${id}`} className="text-xs font-medium">
                              Max per order
                            </label>
                            <input
                              id={`limit-${id}`}
                              inputMode="numeric"
                              placeholder="No limit"
                              className={inputCls}
                              value={r.perOrderLimit}
                              onChange={(e) => setRow(id, { perOrderLimit: e.target.value })}
                              aria-invalid={itemErrors[id] ? true : undefined}
                              aria-describedby={itemErrors[id] ? errorId : undefined}
                            />
                          </div>
                        </div>
                      ) : null}
                      {itemErrors[id] ? (
                        <p id={errorId} className="mt-2 text-xs text-destructive">
                          {itemErrors[id]}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </fieldset>

      {formError ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      {!locked ? (
        <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm">
          <Button type="submit" size="lg" className="min-h-12 w-full text-base" disabled={pending}>
            {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {pending ? "Saving…" : dropId ? "Save changes" : "Create drop"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

// ─── Status controls (edit page) ────────────────────────────────────

type Action = { to: DropStatus; label: string; variant: "default" | "outline" | "destructive" };

function actionFor(from: EffectiveDropStatus, to: DropStatus): Action {
  switch (to) {
    case "OPEN":
      return { to, label: from === "DRAFT" ? "Open orders" : "Reopen orders", variant: "default" };
    case "CLOSED":
      return { to, label: from === "FROZEN" ? "Unfreeze orders" : "Close orders now", variant: "outline" };
    case "FROZEN":
      return { to, label: "Freeze orders", variant: "default" };
    case "FULFILLED":
      return { to, label: "Mark fulfilled", variant: "default" };
    case "DRAFT":
      return { to, label: "Back to draft", variant: "outline" };
  }
}

const STATUS_HELP: Record<EffectiveDropStatus, string> = {
  DRAFT: "Only you can see this drop. Open orders when the menu is ready.",
  SCHEDULED: "Customers can see this drop. Ordering starts at the time you set.",
  OPEN: "Customers can order now, until the cut-off time.",
  CLOSED: "No new orders. Freeze when you start cooking so nobody changes their order.",
  FROZEN: "Orders are locked. Cook, deliver, then mark the drop fulfilled.",
  FULFILLED: "All done. Copy this drop to sell it again.",
};

export type DropStatusControlsProps = {
  dropId: string;
  effectiveStatus: EffectiveDropStatus;
  allowedTransitions: DropStatus[];
  orderCount: number;
  /** True when this open drop hides the vendor's "Order from menu" everyday menu. */
  hidesEverydayMenu?: boolean;
};

export function DropStatusControls({
  dropId,
  effectiveStatus,
  allowedTransitions,
  orderCount,
  hidesEverydayMenu = false,
}: DropStatusControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<{ code: string | null; message: string } | null>(null);
  const [confirm, setConfirm] = useState<"FROZEN" | "DELETE" | null>(null);

  const actions = allowedTransitions.map((to) => actionFor(effectiveStatus, to));

  function change(to: DropStatus) {
    setProblem(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/drops/${dropId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: to }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ApiError;
          setProblem({ code: body.error ?? null, message: conflictMessage(body, "Could not change the status.") });
          return;
        }
        toast.success(`${actionFor(effectiveStatus, to).label} — done.`);
        setConfirm(null);
        router.refresh();
      } catch {
        setProblem({ code: null, message: "Network error — please try again." });
      }
    });
  }

  function remove() {
    setProblem(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/drops/${dropId}`, { method: "DELETE", credentials: "include" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ApiError;
          setProblem({ code: body.error ?? null, message: conflictMessage(body, "Could not delete this drop.") });
          setConfirm(null);
          return;
        }
        toast.success("Drop deleted.");
        router.push("/drops");
        router.refresh();
      } catch {
        setProblem({ code: null, message: "Network error — please try again." });
      }
    });
  }

  return (
    <section aria-labelledby="drop-status" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="drop-status" className="font-display text-lg font-semibold">
          Status
        </h2>
        <DropStatusBadge status={effectiveStatus} />
      </div>
      <p className="text-sm text-muted-foreground">{STATUS_HELP[effectiveStatus]}</p>
      {effectiveStatus === "OPEN" && hidesEverydayMenu ? (
        <p className="text-sm">While this drop is open, your everyday menu is hidden from your store.</p>
      ) : null}

      {actions.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {actions.map((a) => (
            <Button
              key={a.to}
              type="button"
              variant={a.variant}
              className="min-h-11"
              disabled={pending}
              onClick={() => (a.to === "FROZEN" ? setConfirm("FROZEN") : change(a.to))}
            >
              {a.label}
            </Button>
          ))}
        </div>
      ) : null}

      {problem ? (
        <div role="alert" className="space-y-1 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <p>{problem.message}</p>
          <ConflictFix code={problem.code} />
        </div>
      ) : null}

      {orderCount === 0 ? (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 text-destructive hover:text-destructive"
          disabled={pending}
          onClick={() => setConfirm("DELETE")}
        >
          <Trash2 aria-hidden="true" />
          Delete drop
        </Button>
      ) : null}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "DELETE" ? "Delete this drop?" : "Freeze orders?"}</DialogTitle>
            <DialogDescription>
              {confirm === "DELETE"
                ? "The drop and its item list will be removed. This can't be undone."
                : "Customers can no longer change orders. New orders stop too. You'll get the final cooking and delivery list."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirm === "DELETE" ? "destructive" : "default"}
              className="min-h-11"
              disabled={pending}
              onClick={() => (confirm === "DELETE" ? remove() : change("FROZEN"))}
            >
              {confirm === "DELETE" ? "Delete" : "Freeze orders"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─── Badge + copy button (list page) ────────────────────────────────

const BADGE_TONE: Record<EffectiveDropStatus, string> = {
  DRAFT: "border-border bg-muted text-foreground",
  SCHEDULED: "border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  OPEN: "border-green-600/50 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-100",
  CLOSED: "border-border bg-background text-foreground",
  FROZEN: "border-primary/50 bg-primary/10 text-foreground",
  FULFILLED: "border-border bg-muted text-muted-foreground",
};

/** Text first, colour second — readable without colour vision. */
export function DropStatusBadge({ status }: { status: EffectiveDropStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BADGE_TONE[status]}`}
    >
      {DROP_STATUS_LABEL[status]}
    </span>
  );
}

/** "Copy for tomorrow" — duplicates a drop onto tomorrow's IST date and opens the copy. */
export function CopyDropButton({ dropId, title }: { dropId: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function copy() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/drops/${dropId}/duplicate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ date: istTomorrowYmd() }),
        });
        const body = (await res.json().catch(() => ({}))) as ApiError & { data?: { id: string } };
        if (!res.ok || !body.data?.id) {
          toast.error(conflictMessage(body, "Could not copy this drop."));
          return;
        }
        toast.success("Copied for tomorrow. Check the times, then open orders.");
        router.push(`/drops/${body.data.id}/edit`);
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  return (
    <Button
      type="button"
      className="min-h-11 flex-1"
      onClick={copy}
      disabled={pending}
      aria-label={`Copy ${title} for tomorrow`}
    >
      {pending ? (
        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <Copy aria-hidden="true" />
      )}
      {pending ? "Copying…" : "Copy for tomorrow"}
    </Button>
  );
}
