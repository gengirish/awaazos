"use client";

import type { DropStatus } from "@prisma/client";
import { AlertTriangle, CircleCheck, Copy, Loader2, Lock, Mic, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import type { AddedMenuItem } from "@/components/drops/AddMenuItemDialog";
import { VoiceDropPanel, type VoiceApplyResult } from "@/components/drops/VoiceDropPanel";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { formatINR, rupeesToPaise } from "@/lib/currency";
import type { EffectiveDropStatus } from "@/lib/drops";
import {
  DROP_CONFLICT_MESSAGE,
  DROP_SHARE_ANCHOR,
  DROP_STATUS_LABEL,
  PER_ORDER_OVER_MAX,
  cutoffLeadDays,
  defaultDropTitle,
  isValidYmd,
  istTomorrowYmd,
  shiftOrderWindowDates,
} from "@/lib/drops-builder";
import { formatDropDayLabel, formatIstDate, ymdToDbDate } from "@/lib/drops-time";
import {
  NO_VOICE_MARKS,
  mergeDropDraft,
  paiseToRupeeInput,
  unmarkField,
  unmarkItem,
  type DropFormFields,
  type DropFormRow,
  type DropFormSnapshot,
  type VoiceMarks,
} from "@/lib/drop-voice";
import type { DropDraft } from "@/lib/parse-drop-types";
import type { DropUpsertInput } from "@/lib/zod-drops";

// ─── Shared bits ────────────────────────────────────────────────────

const inputCls =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive";

/**
 * Native date / time pickers. `appearance-none` + `min-w-0` make iOS Safari
 * honour the full width (its native control keeps an intrinsic width and can
 * poke out of a narrow grid cell); the 44px floor comes from `inputCls`.
 */
const pickerCls = `${inputCls} min-w-0 appearance-none`;

/**
 * Section heading row. On phones it sticks to the top of the screen while its
 * section scrolls, so a cook half-way down a long item list still sees where
 * she is (and how many items are picked). From md it is the plain heading.
 */
const sectionHeadCls =
  "-mx-4 -mt-4 flex flex-wrap items-center justify-between gap-2 rounded-t-xl bg-card px-4 pt-4 max-md:sticky max-md:top-[env(safe-area-inset-top)] max-md:z-10 max-md:border-b max-md:border-border max-md:pb-2 max-md:pt-3";

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

const paiseToInput = paiseToRupeeInput;

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

/** A text link that is still a 44px tap target. */
const fixLinkCls = "inline-flex min-h-11 items-center font-semibold underline underline-offset-2";

/** Publishing is the owner's call; a manager has nothing to tap, so say exactly what to ask for. */
const ASK_OWNER_TO_PUBLISH =
  "Only the owner can publish the store. Ask them to open orders on this drop, or to publish the store in Settings → Online store.";

/** Link to the setting that fixes a given 409, if there is one. */
function ConflictFix({ code, canPublishStore }: { code: string | null; canPublishStore: boolean }) {
  if (code === "storefront_not_published") {
    if (!canPublishStore) return <p className="font-semibold">{ASK_OWNER_TO_PUBLISH}</p>;
    return (
      <Link href="/settings/store" className={fixLinkCls}>
        Open Online store settings to publish it
      </Link>
    );
  }
  if (code === "no_payment_method") {
    return (
      <Link href="/settings/payments" className={fixLinkCls}>
        Open payment settings
      </Link>
    );
  }
  return null;
}

/** "From voice" marker — text + icon, not colour alone. */
function FromVoiceBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-xs font-medium text-foreground">
      <Mic className="h-3 w-3" aria-hidden="true" />
      From voice
    </span>
  );
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
    <Notice id={id} tone="warning" icon className="p-2 text-xs">
      {text} Customers can&apos;t order after that — check this is what you meant.
    </Notice>
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

type Row = DropFormRow;
type FormState = DropFormFields;

export type DropFormProps = {
  menuItems: DropFormMenuItem[];
  initial: DropUpsertInput;
  /** Absent = create. */
  dropId?: string;
  /** Frozen / fulfilled drops are read-only. */
  locked?: boolean;
  /** menuItemId → qty already reserved by buyers (edit only). */
  soldByMenuItem?: Record<string, number>;
  /** VendorSettings.voiceLang. Present = show the voice panel (hidden when locked). */
  voiceLang?: string;
  /** Owners can publish the store while opening orders, and get the billing link when voice is paused. */
  isOwner?: boolean;
  /** Create only: what "Save and open orders" needs to ask an owner about a private store first. */
  openFlow?: { storePublished: boolean; storePath: string };
};

const MODES: { value: FormState["fulfilmentMode"]; label: string }[] = [
  { value: "DELIVERY", label: "Delivery" },
  { value: "PICKUP", label: "Pickup" },
  { value: "BOTH", label: "Both" },
];

export function DropForm({
  menuItems,
  initial,
  dropId,
  locked = false,
  soldByMenuItem = {},
  voiceLang,
  isOwner = false,
  openFlow,
}: DropFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // A failed save: show how many things need fixing and go to the first one.
  const [showFixCount, setShowFixCount] = useState(false);
  const [errorFocusTick, setErrorFocusTick] = useState(0);
  const handledFocusTick = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  // Create: the drop exists from here on, so the form must not create it again.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [askPublish, setAskPublish] = useState(false);

  // The menu is state, not the prop: the voice panel can add a dish to it.
  const [menu, setMenu] = useState(menuItems);

  // A new drop is named after its cooking day until the cook types her own title.
  const [titleAuto, setTitleAuto] = useState(() => !dropId && initial.title.trim() === "");

  const [form, setForm] = useState<FormState>(() => ({
    title: !dropId && initial.title.trim() === "" ? defaultDropTitle(initial.date) : initial.title,
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

  // Drop items first (in their saved order), then the rest of the menu. Voice
  // can reorder it (dishes in the order they were spoken).
  const [order, setOrder] = useState<string[]>(() => {
    const inDrop = initial.items.map((i) => i.menuItemId);
    const seen = new Set(inDrop);
    return [...inDrop, ...menuItems.map((m) => m.id).filter((id) => !seen.has(id))];
  });

  const menuById = useMemo(() => new Map(menu.map((m) => [m.id, m])), [menu]);

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

  // Voice: which fields came from the last take, and the form before it (undo).
  const [voiceMarks, setVoiceMarks] = useState<VoiceMarks>(NO_VOICE_MARKS);
  const [beforeVoice, setBeforeVoice] = useState<{
    snapshot: DropFormSnapshot;
    marks: VoiceMarks;
    lastCookingDate: string;
    titleAuto: boolean;
  } | null>(null);
  const fromVoice = (...keys: (keyof FormState)[]) => keys.some((k) => voiceMarks.fields.includes(k));

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
    setVoiceMarks((m) => unmarkField(m, key));
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
    const autoTitle = titleAuto ? defaultDropTitle(next) : "";
    setForm((f) => ({
      ...shiftOrderWindowDates(f, prev, next, touched),
      date: next,
      ...(autoTitle ? { title: autoTitle } : {}),
    }));
    setFieldErrors((e) =>
      e.date || e.closesAtDate || e.closesAtTime || e.opensAtDate || (autoTitle && e.title)
        ? { ...e, date: "", closesAtDate: "", closesAtTime: "", opensAtDate: "", ...(autoTitle ? { title: "" } : {}) }
        : e,
    );
    setVoiceMarks((m) => unmarkField(m, "date"));
  };
  const leadDays = cutoffLeadDays(form.date, form.closesAtDate);
  const setRow = (id: string, patch: Partial<Row>) => {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
    setItemErrors((e) => (e[id] ? { ...e, [id]: "" } : e));
    setVoiceMarks((m) => unmarkItem(m, id));
  };

  // Ticking a dish moves its row into the selected group at the top. Keep the
  // keyboard focus on its checkbox and the row on screen, so the price and
  // quantity fields that just appeared are where the cook is looking.
  const toggledId = useRef<string | null>(null);
  const toggleRow = (id: string, selected: boolean) => {
    toggledId.current = id;
    setRow(id, { selected });
    if (selected) setFieldErrors((e) => (e.items ? { ...e, items: "" } : e));
  };
  useEffect(() => {
    const id = toggledId.current;
    if (!id) return;
    toggledId.current = null;
    const box = document.getElementById(`pick-${id}`);
    if (!box) return;
    if (document.activeElement !== box) box.focus({ preventScroll: true });
    box.closest("li")?.scrollIntoView({ block: "nearest" });
  }, [rows]);

  /** A dish added to the menu from the voice panel: list it, ticked, with the spoken quantity. */
  const addMenuItem = useCallback((item: AddedMenuItem, quantity: number | null) => {
    const maxQty = quantity !== null && Number.isInteger(quantity) && quantity > 0 && quantity <= 99_999;
    setMenu((m) => (m.some((x) => x.id === item.id) ? m : [...m, item]));
    setRows((r) => ({
      ...r,
      [item.id]: {
        selected: true,
        price: paiseToInput(item.priceInPaise),
        maxQty: maxQty ? String(quantity) : "",
        perOrderLimit: "",
      },
    }));
    setOrder((o) => (o.includes(item.id) ? o : [...o, item.id]));
    setVoiceMarks((m) => (m.items.includes(item.id) ? m : { ...m, items: [...m.items, item.id] }));
    setFieldErrors((e) => (e.items ? { ...e, items: "" } : e));
    toast.success(`${item.name} added to your menu and ticked for this drop.`);
  }, []);

  /** Merge a parsed voice draft into the form. Never saves. */
  const applyVoiceDraft = useCallback(
    (draft: DropDraft): VoiceApplyResult => {
      const prev: DropFormSnapshot = { form, rows, order };
      const result = mergeDropDraft(prev, draft, menu, touchedDates.current);
      setBeforeVoice({ snapshot: prev, marks: voiceMarks, lastCookingDate: lastCookingDate.current, titleAuto });
      if (isValidYmd(result.next.form.date)) lastCookingDate.current = result.next.form.date;
      // A spoken title replaces the day-based one for good; a spoken day alone renames it.
      const spokeTitle = result.marks.fields.includes("title");
      const dayTitle = titleAuto && !spokeTitle ? defaultDropTitle(result.next.form.date) : "";
      if (spokeTitle) setTitleAuto(false);
      setForm(dayTitle ? { ...result.next.form, title: dayTitle } : result.next.form);
      setRows(result.next.rows);
      setOrder(result.next.order);
      setVoiceMarks(result.marks);
      setFieldErrors({});
      setItemErrors({});
      setFormError(null);
      setShowFixCount(false);
      setFilter("");
      return result;
    },
    [form, rows, order, menu, voiceMarks, titleAuto],
  );

  const undoVoice = useCallback(() => {
    if (!beforeVoice) return;
    const snap = beforeVoice.snapshot;
    // Dishes added to the menu since that take stay in the list (they are saved), unticked.
    const added = menu.filter((m) => !(m.id in snap.rows));
    const addedRows: Record<string, Row> = {};
    for (const m of added) {
      addedRows[m.id] = { selected: false, price: paiseToInput(m.priceInPaise), maxQty: "", perOrderLimit: "" };
    }
    setForm(snap.form);
    setRows({ ...snap.rows, ...addedRows });
    setOrder([...snap.order, ...added.map((m) => m.id)]);
    setVoiceMarks(beforeVoice.marks);
    setTitleAuto(beforeVoice.titleAuto);
    lastCookingDate.current = beforeVoice.lastCookingDate;
    setFieldErrors({});
    setItemErrors({});
    setFormError(null);
    setShowFixCount(false);
    setBeforeVoice(null);
  }, [beforeVoice, menu]);

  // `order` decides `sortOrder`; the list shows the ticked dishes first, each
  // group in that same order.
  const selectedIds = order.filter((id) => rows[id]?.selected && menuById.has(id));
  const needle = filter.trim().toLowerCase();
  const matchingIds = order.filter((id) => {
    const name = menuById.get(id)?.name;
    return name !== undefined && (!needle || name.toLowerCase().includes(needle));
  });
  const visibleIds = [
    ...matchingIds.filter((id) => rows[id]?.selected),
    ...matchingIds.filter((id) => !rows[id]?.selected),
  ];

  function buildPayload(): DropUpsertInput | null {
    const fe: Record<string, string> = {};
    const ie: Record<string, string> = {};

    if (!form.title.trim()) fe.title = "Give this drop a name, e.g. Saturday bakes";

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

  /** After a failed save: count what is wrong and take the cook to the first field. */
  function flagErrors() {
    setShowFixCount(true);
    setFilter("");
    setErrorFocusTick((t) => t + 1);
  }
  // Runs once the fields are enabled again (they are disabled while saving).
  useEffect(() => {
    if (pending || errorFocusTick === handledFocusTick.current) return;
    handledFocusTick.current = errorFocusTick;
    const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-error-anchor]');
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }, [errorFocusTick, pending]);

  const editHref = (id: string) => `/drops/${id}/edit`;

  /**
   * "Save and open orders", after the drop was created. Whatever happens the
   * cook lands on the edit page: with orders open, or with the Status
   * checklist showing what is still missing. The server decides (409).
   */
  async function openCreated(id: string, publishStore: boolean) {
    try {
      const res = await fetch(`/api/drops/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(publishStore ? { status: "OPEN", publishStorefront: true } : { status: "OPEN" }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiError & {
        data?: { effectiveStatus?: EffectiveDropStatus };
      };
      if (res.ok) {
        toast.success(
          publishStore ? "Your store is live and orders are open." : openedMessage(body.data?.effectiveStatus),
        );
        router.push(`${editHref(id)}?opened=1`);
        return;
      }
      // The store turned out to be private: an owner is asked before it goes public.
      if (body.error === "storefront_not_published" && isOwner && !publishStore) {
        setAskPublish(true);
        return;
      }
      toast.warning("Saved as a draft. Orders aren't open yet — see what's left under Status.");
    } catch {
      toast.warning("Saved as a draft. Couldn't open orders — try again from this page.");
    }
    setAskPublish(false);
    router.push(editHref(id));
  }

  function save(openAfter: boolean) {
    if (locked || pending || createdId) return;
    setFormError(null);
    setShowFixCount(false);
    const payload = buildPayload();
    if (!payload) {
      flagErrors();
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
          flagErrors();
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
          const id = body.data.id;
          setCreatedId(id);
          if (!openAfter) {
            toast.success("Draft saved. It stays hidden until you open orders.");
            router.push(editHref(id));
          } else if (isOwner && openFlow && !openFlow.storePublished) {
            setAskPublish(true);
          } else {
            await openCreated(id, false);
          }
        }
      } catch {
        setFormError("Network error — please try again.");
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    save(false);
  }

  /** The owner backed out of publishing: the draft is kept, the store stays private. */
  function declinePublish() {
    if (!createdId || pending) return;
    setAskPublish(false);
    toast.warning("Saved as a draft. Your store is still private, so orders aren't open.");
    router.push(editHref(createdId));
  }

  const errorCount =
    Object.values(fieldErrors).filter(Boolean).length + Object.values(itemErrors).filter(Boolean).length;
  const saveAlert =
    formError ??
    (showFixCount && errorCount > 0
      ? `${errorCount} ${errorCount === 1 ? "thing" : "things"} to fix. We've taken you to the first one.`
      : null);
  const busy = pending || createdId !== null;

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
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      // A field scrolled into view (focus, keyboard, validation) stops clear of
      // the sticky save bar below and, on phones, the sticky section heading above.
      className="space-y-6 [&_:is(input,textarea,button,a)]:scroll-mb-24 max-md:[&_:is(input,textarea,button,a)]:scroll-mt-16"
      aria-busy={pending}
    >
      {locked ? (
        <p role="status" className="rounded-md border border-border bg-muted/50 p-3 text-sm">
          Orders are locked, so this drop can&apos;t be edited any more.
        </p>
      ) : null}

      {voiceLang && !locked ? (
        <VoiceDropPanel
          voiceLang={voiceLang}
          isEdit={Boolean(dropId)}
          onDraft={applyVoiceDraft}
          onUndo={undoVoice}
          canUndo={beforeVoice !== null}
          onMenuItemAdded={addMenuItem}
          canManageBilling={isOwner}
        />
      ) : null}

      <fieldset disabled={locked || pending} className="space-y-6">
        {/* ── Basics ── */}
        <section aria-labelledby="drop-basics" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className={sectionHeadCls}>
            <h2 id="drop-basics" className="font-display text-lg font-semibold">
              Name and day
            </h2>
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="drop-title" className="text-sm font-medium">
                Title
              </label>
              <FromVoiceBadge show={fromVoice("title")} />
            </div>
            <input
              id="drop-title"
              className={inputCls}
              maxLength={80}
              placeholder="Saturday bakes"
              value={form.title}
              onChange={(e) => {
                setTitleAuto(false);
                set("title", e.target.value);
              }}
              {...errProps("title")}
              aria-describedby={describedBy("title", titleAuto ? "drop-title-hint" : null)}
            />
            {titleAuto ? (
              <p id="drop-title-hint" className="text-xs text-muted-foreground">
                Named after the cooking day. Type your own name to change it.
              </p>
            ) : null}
            {err("title")}
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="drop-note" className="text-sm font-medium">
                Note for customers <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <FromVoiceBadge show={fromVoice("note")} />
            </div>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="drop-date" className="text-sm font-medium">
                Cooking day
              </label>
              <FromVoiceBadge show={fromVoice("date")} />
            </div>
            <input
              id="drop-date"
              type="date"
              className={pickerCls}
              value={form.date}
              onChange={(e) => setCookingDate(e.target.value)}
              {...errProps("date")}
            />
            <p className="text-xs text-muted-foreground">{ymdHint(form.date)}</p>
            {err("date")}
          </div>
        </section>

        {/* ── Items ── */}
        <section aria-labelledby="drop-items" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className={sectionHeadCls}>
            <h2 id="drop-items" className="font-display text-lg font-semibold">
              What are you selling?
            </h2>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {selectedIds.length} selected
            </p>
          </div>
          {fieldErrors.items ? (
            // No field to mark invalid here, so the message itself takes the focus after a failed save.
            <p
              id="items-error"
              data-error-anchor
              tabIndex={-1}
              className="rounded-sm text-xs text-destructive focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {fieldErrors.items}
            </p>
          ) : null}
          {menu.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Your menu is empty.{" "}
              <Link
                href="/menu"
                className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2"
              >
                Add menu items
              </Link>{" "}
              first, then come back.
            </p>
          ) : (
            <>
              {menu.length > 10 ? (
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
                      className={`scroll-mb-28 scroll-mt-16 rounded-lg border p-3 ${r.selected ? "border-primary/60 bg-primary/5" : "border-border"}`}
                    >
                      <label className="flex min-h-11 cursor-pointer items-center gap-3">
                        <input
                          id={`pick-${id}`}
                          type="checkbox"
                          className="h-5 w-5 shrink-0 accent-primary"
                          checked={r.selected}
                          onChange={(e) => toggleRow(id, e.target.checked)}
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
                      {r.selected && voiceMarks.items.includes(id) ? (
                        <div className="mt-2">
                          <FromVoiceBadge show />
                        </div>
                      ) : null}
                      {r.selected ? (
                        // Phones: two per row (three 85px inputs cut off "No limit"
                        // and wrap the labels unevenly). `justify-end` keeps the
                        // inputs level if a label still wraps.
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          <div className="flex flex-col justify-end gap-1">
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
                          <div className="flex flex-col justify-end gap-1">
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
                          <div className="flex flex-col justify-end gap-1">
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

        {/* ── Fulfilment ── */}
        <section aria-labelledby="drop-fulfilment" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className={sectionHeadCls}>
            <h2 id="drop-fulfilment" className="font-display text-lg font-semibold">
              Delivery or pickup
            </h2>
            <FromVoiceBadge show={fromVoice("fulfilmentMode")} />
          </div>
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="drop-start" className="text-sm font-medium">
                  From
                </label>
                <FromVoiceBadge show={fromVoice("fulfilmentStart")} />
              </div>
              <input
                id="drop-start"
                type="time"
                className={pickerCls}
                value={form.fulfilmentStart}
                onChange={(e) => set("fulfilmentStart", e.target.value)}
                {...errProps("fulfilmentStart")}
              />
              {err("fulfilmentStart")}
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="drop-end" className="text-sm font-medium">
                  Until
                </label>
                <FromVoiceBadge show={fromVoice("fulfilmentEnd")} />
              </div>
              <input
                id="drop-end"
                type="time"
                className={pickerCls}
                value={form.fulfilmentEnd}
                onChange={(e) => set("fulfilmentEnd", e.target.value)}
                {...errProps("fulfilmentEnd")}
              />
              {err("fulfilmentEnd")}
            </div>
          </div>
          {form.fulfilmentMode !== "PICKUP" ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="drop-fee" className="text-sm font-medium">
                  Delivery fee (₹)
                </label>
                <FromVoiceBadge show={fromVoice("deliveryFee")} />
              </div>
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="drop-pickup" className="text-sm font-medium">
                  Pickup instructions <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <FromVoiceBadge show={fromVoice("pickupNote")} />
              </div>
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
          <div className={sectionHeadCls}>
            <h2 id="drop-window" className="font-display text-lg font-semibold">
              When can customers order?
            </h2>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Last time to order</legend>
            <FromVoiceBadge show={fromVoice("closesAtDate", "closesAtTime")} />
            <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 min-[400px]:gap-3">
              <input
                type="date"
                aria-label="Order cut-off date"
                className={pickerCls}
                value={form.closesAtDate}
                onChange={(e) => setOrderWindowDate("closesAtDate", e.target.value)}
                {...errProps("closesAtDate")}
                aria-describedby={describedBy("closesAtDate", leadDays !== null && leadDays >= 0 ? "cutoff-lead" : null)}
              />
              <input
                type="time"
                aria-label="Order cut-off time"
                className={pickerCls}
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
              <FromVoiceBadge show={fromVoice("opensAtDate", "opensAtTime")} />
              <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 min-[400px]:gap-3">
                <input
                  type="date"
                  aria-label="Orders open date"
                  className={pickerCls}
                  value={form.opensAtDate}
                  onChange={(e) => setOrderWindowDate("opensAtDate", e.target.value)}
                  {...errProps("opensAtDate")}
                />
                <input
                  type="time"
                  aria-label="Orders open time"
                  className={pickerCls}
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
            {fromVoice("showEverydayMenu") ? (
              <div className="pl-8">
                <FromVoiceBadge show />
              </div>
            ) : null}
          </div>
        </section>
      </fieldset>

      {!locked ? (
        <div className="sticky bottom-[var(--app-bottom-inset,0px)] z-20 -mx-4 space-y-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm">
          {saveAlert ? (
            <Notice role="alert" tone="danger" icon>
              {saveAlert}
            </Notice>
          ) : null}
          {dropId ? (
            <Button type="submit" size="lg" className="min-h-12 w-full text-base" disabled={busy}>
              {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {pending ? "Saving…" : "Save changes"}
            </Button>
          ) : (
            // Enter in a field saves the draft; opening orders is always a deliberate tap.
            <div className="grid grid-cols-2 gap-2">
              <Button type="submit" variant="outline" size="lg" className="min-h-12 px-2 text-base" disabled={busy}>
                {busy ? "Saving…" : "Create drop"}
              </Button>
              <Button
                type="button"
                size="lg"
                className="min-h-12 whitespace-normal px-2 text-base leading-tight"
                disabled={busy}
                onClick={() => save(true)}
              >
                {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                Save and open orders
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {/* Create + open, private store: the owner decides before anything goes public. */}
      <ResponsiveDialog open={askPublish} onOpenChange={(o) => !o && declinePublish()}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Publish your store too?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Your drop is saved as a draft. Your store page is private, so customers can&apos;t order from it yet.
              Publishing it lets anyone with the link see your item names and prices at{" "}
              <span className="break-all font-mono text-foreground">{openFlow?.storePath}</span>. You can make it
              private again in Settings → Online store.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={declinePublish}>
              Keep as a draft
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={pending}
              onClick={() => {
                if (createdId) startTransition(() => openCreated(createdId, true));
              }}
            >
              Publish store and open orders
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </form>
  );
}

// ─── Status controls (edit page) ────────────────────────────────────

type Action = {
  to: DropStatus;
  label: string;
  variant: "default" | "outline" | "destructive";
  /** One line under the button, for the actions whose name doesn't explain itself. */
  help?: string;
};

function actionFor(from: EffectiveDropStatus, to: DropStatus): Action {
  switch (to) {
    case "OPEN":
      return { to, label: from === "DRAFT" ? "Open orders" : "Reopen orders", variant: "default" };
    case "CLOSED":
      return from === "FROZEN"
        ? {
            to,
            label: "Unlock orders",
            variant: "outline",
            help: "Lets you edit this drop again. Customers still can't order.",
          }
        : { to, label: "Close orders now", variant: "outline" };
    case "FROZEN":
      return {
        to,
        label: "Lock orders",
        variant: "default",
        help: "Stops new orders and changes, so your cooking list is final.",
      };
    case "FULFILLED":
      return {
        to,
        label: "Mark done",
        variant: "default",
        help: "For when every order is handed over. This can't be undone.",
      };
    case "DRAFT":
      return { to, label: "Back to draft", variant: "outline" };
  }
}

/** Toast after orders open. With a later start time the drop is visible but not yet taking orders. */
function openedMessage(effectiveAfter: EffectiveDropStatus | undefined): string {
  return effectiveAfter === "SCHEDULED" ? "Drop is live. Ordering starts at the time you set." : "Orders are open";
}

/** Toast for each status change, in the seller's words (never built from a button label). */
function changedMessage(from: EffectiveDropStatus, to: DropStatus, effectiveAfter?: EffectiveDropStatus): string {
  switch (to) {
    case "OPEN":
      return openedMessage(effectiveAfter);
    case "CLOSED":
      return from === "FROZEN" ? "Orders unlocked. You can edit this drop again." : "Orders closed.";
    case "FROZEN":
      return "Orders locked.";
    case "FULFILLED":
      return "Drop marked done.";
    case "DRAFT":
      return "Back to draft. Customers can't see this drop.";
  }
}

const STATUS_HELP: Record<EffectiveDropStatus, string> = {
  DRAFT: "Only you can see this drop. Open orders when the menu is ready.",
  SCHEDULED: "Customers can see this drop. Ordering starts at the time you set.",
  OPEN: "Customers can order now, until the cut-off time.",
  CLOSED: "No new orders. Lock orders when you start cooking so nobody changes their order.",
  FROZEN: "Orders are locked. Cook, deliver, then mark the drop done.",
  FULFILLED: "All done. Copy this drop to sell it again.",
};

type OpenCheck = {
  key: string;
  /** `ok` done, `todo` blocks opening, `ask` is settled in the tap that opens orders. */
  state: "ok" | "todo" | "ask";
  text: string;
  fix?: { href: string; label: string };
};

const CHECK_PREFIX: Record<OpenCheck["state"], string> = { ok: "Done: ", todo: "To do: ", ask: "Note: " };

/** One line of the "before you open orders" list: icon + words, never colour alone. */
function OpenCheckLine({ check }: { check: OpenCheck }) {
  const Icon = check.state === "ok" ? CircleCheck : check.state === "ask" ? Lock : AlertTriangle;
  return (
    <li className="flex flex-wrap items-center gap-x-3 px-3">
      <Icon
        className={`h-4 w-4 shrink-0 ${
          check.state === "ok"
            ? "text-green-700 dark:text-green-400"
            : check.state === "todo"
              ? "text-amber-700 dark:text-amber-300"
              : "text-muted-foreground"
        }`}
        aria-hidden="true"
      />
      <span className={`min-w-0 flex-1 py-3 text-sm ${check.state === "todo" ? "font-medium" : ""}`}>
        <span className="sr-only">{CHECK_PREFIX[check.state]}</span>
        {check.text}
      </span>
      {check.fix ? (
        // In-page anchors and settings pages alike; a plain <a> keeps the hash jump native.
        <a href={check.fix.href} className={`${fixLinkCls} text-sm text-primary`}>
          {check.fix.label}
        </a>
      ) : null}
    </li>
  );
}

export type DropStatusControlsProps = {
  dropId: string;
  effectiveStatus: EffectiveDropStatus;
  allowedTransitions: DropStatus[];
  orderCount: number;
  /** True when this open drop hides the vendor's "Order from menu" everyday menu. */
  hidesEverydayMenu?: boolean;
  /** VendorSettings.publishStorefront. Opening orders needs it. */
  storePublished: boolean;
  /** Owners can publish the store in the same tap that opens orders. */
  canPublishStore: boolean;
  /** "/s/<slug>", shown in the publish confirmation. */
  storePath: string;
  /** Saved items on this drop. Opening orders needs at least one. */
  itemCount: number;
  /** Was the cut-off still ahead when the page loaded? (Evaluated on the server render, never on a timer.) */
  cutoffInFuture: boolean;
  /** A UPI ID or pay on delivery is set up. */
  hasPaymentMethod: boolean;
  /** Arrived from "Save and open orders": take the seller to the share block. */
  justOpened?: boolean;
};

export function DropStatusControls({
  dropId,
  effectiveStatus,
  allowedTransitions,
  orderCount,
  hidesEverydayMenu = false,
  storePublished,
  canPublishStore,
  storePath,
  itemCount,
  cutoffInFuture,
  hasPaymentMethod,
  justOpened = false,
}: DropStatusControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<{ code: string | null; message: string } | null>(null);
  const [confirm, setConfirm] = useState<"FROZEN" | "DELETE" | "PUBLISH" | null>(null);

  // Orders just opened (here, or on the create page): the next job is telling
  // customers, so move to the share block once the refreshed page shows it.
  const goToShare = useRef(justOpened);
  useEffect(() => {
    if (!goToShare.current) return;
    if (effectiveStatus !== "OPEN" && effectiveStatus !== "SCHEDULED") return;
    goToShare.current = false;
    const share = document.getElementById(DROP_SHARE_ANCHOR);
    share?.scrollIntoView({ block: "center" });
    share?.focus({ preventScroll: true });
    // Drop "?opened=1" so a reload doesn't jump again.
    if (justOpened) window.history.replaceState(null, "", window.location.pathname);
  }, [effectiveStatus, justOpened]);

  // What opening orders needs, shown before the tap. The server's 409 still decides.
  const canOpen = allowedTransitions.includes("OPEN");
  const checks: OpenCheck[] = [
    itemCount > 0
      ? { key: "items", state: "ok", text: `${itemCount} ${itemCount === 1 ? "item" : "items"} added` }
      : {
          key: "items",
          state: "todo",
          text: "No items yet. Tick at least one and save.",
          fix: { href: "#drop-items", label: "Add items" },
        },
    cutoffInFuture
      ? { key: "cutoff", state: "ok", text: "The last time to order is still ahead" }
      : {
          key: "cutoff",
          state: "todo",
          text: "The last time to order has passed. Move it later and save.",
          fix: { href: "#drop-window", label: "Change it" },
        },
    hasPaymentMethod
      ? { key: "payment", state: "ok", text: "Customers have a way to pay" }
      : {
          key: "payment",
          state: "todo",
          text: "Customers have no way to pay yet. Add your UPI ID or allow pay on delivery.",
          fix: { href: "/settings/payments", label: "Open payment settings" },
        },
    storePublished
      ? { key: "store", state: "ok", text: "Your store is published" }
      : canPublishStore
        ? {
            key: "store",
            state: "ask",
            text: "Your store is private. You'll be asked to publish it when you open orders.",
          }
        : { key: "store", state: "todo", text: `Your store is private. ${ASK_OWNER_TO_PUBLISH}` },
  ];
  const todoCount = checks.filter((c) => c.state === "todo").length;

  const actions = allowedTransitions.map((to) => actionFor(effectiveStatus, to));
  const publishLabel = `Publish store and ${actionFor(effectiveStatus, "OPEN").label.toLowerCase()}`;

  /** `publishStore`: the owner confirmed making the store public along with opening orders. */
  function change(to: DropStatus, publishStore = false) {
    setProblem(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/drops/${dropId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(publishStore ? { status: to, publishStorefront: true } : { status: to }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ApiError;
          // The store went private after this page loaded: ask, don't dead-end.
          if (body.error === "storefront_not_published" && canPublishStore && !publishStore) {
            setConfirm("PUBLISH");
            return;
          }
          setConfirm(null);
          setProblem({ code: body.error ?? null, message: conflictMessage(body, "Could not change the status.") });
          // Something changed since this page loaded: bring the checklist up to date.
          router.refresh();
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { data?: { effectiveStatus?: EffectiveDropStatus } };
        toast.success(
          publishStore
            ? "Your store is live and orders are open."
            : changedMessage(effectiveStatus, to, body.data?.effectiveStatus),
        );
        if (to === "OPEN") goToShare.current = true;
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

      {canOpen ? (
        <div className="space-y-1.5">
          <h3 id="drop-open-checks-title" className="text-sm font-medium">
            {todoCount === 0
              ? "Ready to open orders"
              : `${todoCount} ${todoCount === 1 ? "thing" : "things"} to sort out before you open orders`}
          </h3>
          <ul
            id="drop-open-checks"
            aria-labelledby="drop-open-checks-title"
            className="divide-y divide-border rounded-md border border-border"
          >
            {checks.map((c) => (
              <OpenCheckLine key={c.key} check={c} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">This list is for the drop as last saved.</p>
        </div>
      ) : null}

      {actions.length ? (
        <div className="grid items-start gap-2 sm:grid-cols-2">
          {actions.map((a) => (
            <div key={a.to} className="space-y-1">
              <Button
                type="button"
                variant={a.variant}
                className="min-h-11 w-full"
                disabled={pending}
                aria-describedby={
                  [a.to === "OPEN" ? "drop-open-checks-title" : null, a.help ? `drop-action-${a.to}-help` : null]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onClick={() => {
                  if (a.to === "FROZEN") setConfirm("FROZEN");
                  else if (a.to === "OPEN" && !storePublished && canPublishStore) setConfirm("PUBLISH");
                  else change(a.to);
                }}
              >
                {a.label}
              </Button>
              {a.help ? (
                <p id={`drop-action-${a.to}-help`} className="text-xs text-muted-foreground">
                  {a.help}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {problem ? (
        <Notice role="alert" className="space-y-1">
          <p>{problem.message}</p>
          <ConflictFix code={problem.code} canPublishStore={canPublishStore} />
        </Notice>
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

      <ResponsiveDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {confirm === "DELETE"
                ? "Delete this drop?"
                : confirm === "PUBLISH"
                  ? "Publish your store too?"
                  : "Lock orders?"}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {confirm === "DELETE" ? (
                "The drop and its item list will be removed. This can't be undone."
              ) : confirm === "PUBLISH" ? (
                <>
                  Your store page is private, so customers can&apos;t order from this drop yet. Publishing it lets
                  anyone with the link see your item names and prices at{" "}
                  <span className="break-all font-mono text-foreground">{storePath}</span>. You can make it private
                  again in Settings → Online store.
                </>
              ) : (
                "Customers can no longer change orders. New orders stop too. You'll get the final cooking and delivery list."
              )}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirm === "DELETE" ? "destructive" : "default"}
              className="min-h-11"
              disabled={pending}
              onClick={() => {
                if (confirm === "DELETE") remove();
                else if (confirm === "PUBLISH") change("OPEN", true);
                else change("FROZEN");
              }}
            >
              {confirm === "DELETE" ? "Delete" : confirm === "PUBLISH" ? publishLabel : "Lock orders"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
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

/**
 * "Copy for tomorrow" — duplicates a drop onto tomorrow's IST date and opens the copy.
 * `secondary`: the outline version, for cards whose main action is something else.
 */
export function CopyDropButton({
  dropId,
  title,
  secondary = false,
}: {
  dropId: string;
  title: string;
  secondary?: boolean;
}) {
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
      variant={secondary ? "outline" : "default"}
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
