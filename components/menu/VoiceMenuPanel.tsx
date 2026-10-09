"use client";

import { AlertCircle, CheckCircle2, HelpCircle, Loader2, Mic, Plus, RotateCcw, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { FOOD_EMOJIS } from "@/components/menu/MenuItemForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOnline } from "@/hooks/useOnline";
import { useVoiceDictation, type DictationError } from "@/hooks/useVoiceDictation";
import { formatINRCompact } from "@/lib/currency";
import {
  appendRows,
  buildBulkBody,
  categoryOptions,
  convertToNew,
  draftToRows,
  isActive,
  MAX_ROWS_PER_SAVE,
  parseRupeeInput,
  primaryLabel,
  rowCounts,
  saveSummary,
  skippedReasonText,
  validateRows,
  type MenuVoiceRow,
  type RowErrors,
} from "@/lib/menu-voice";
import type { MenuDraft } from "@/lib/parse-menu-types";
import { cn } from "@/lib/utils";

export type VoiceMenuPanelProps = {
  voiceLang: string;
  /** Categories already on this vendor's menu (for the category datalist). */
  categories: string[];
  /** Items already on the menu. 0 → the panel starts expanded. */
  itemCount: number;
  /** Start expanded even when the menu has items (`/menu?voice=1`). */
  defaultOpen?: boolean;
};

const LANG_LABEL: Record<string, string> = {
  "en-IN": "English",
  "hi-IN": "हिन्दी (Hindi)",
  "te-IN": "తెలుగు (Telugu)",
  "kn-IN": "ಕನ್ನಡ (Kannada)",
  "ta-IN": "தமிழ் (Tamil)",
};

/** How a stall owner would rattle off a few dishes in that language (romanised). */
const EXAMPLE: Record<string, string> = {
  "en-IN": "Masala chai 15 rupees, cutting chai 10, samosa 20, vada pav 25 in snacks. Mango lassi 60, drinks.",
  "hi-IN": "Masala chai 15 rupaye, cutting chai 10, samosa 20, vada pav 25 — snacks mein. Mango lassi 60, drinks.",
  "te-IN": "Masala chai 15 rupayalu, samosa 20, vada pav 25 snacks lo. Mango lassi 60, drinks.",
  "kn-IN": "Masala chai 15 rupayi, samosa 20, vada pav 25 snacks alli. Mango lassi 60, drinks.",
  "ta-IN": "Masala chai 15 roobai, samosa 20, vada pav 25 snacks-la. Mango lassi 60, drinks.",
};

const FORM_HINT = "use “Add item” below";

const ERROR_MESSAGES: Record<string, string> = {
  voice_unavailable: `Voice isn't available right now — ${FORM_HINT}.`,
  ai_limit: `Voice limit reached for your plan — ${FORM_HINT}.`,
  rate_limited: `Too many voice tries — wait a minute, or ${FORM_HINT}.`,
  not_allowed: `Voice isn't available for your account here — ${FORM_HINT}.`,
  mic_denied: `Microphone blocked — allow mic access, or ${FORM_HINT}.`,
  stt_unsupported: `This browser can't take voice input — ${FORM_HINT}.`,
  lang_not_supported_stt: `This browser can't hear your language — try Chrome, or ${FORM_HINT}.`,
  unsupported_lang: `Voice isn't set up for your language — ${FORM_HINT}.`,
  use_webspeech: `Voice isn't set up for your language — ${FORM_HINT}.`,
  network_error: `No internet for voice — check your connection, or ${FORM_HINT}.`,
  empty_transcript: `Didn't hear anything — tap the mic and speak, or ${FORM_HINT}.`,
  no_speech_detected: `Didn't hear anything — tap the mic and speak, or ${FORM_HINT}.`,
  nothing_found: `Couldn't find any dishes in that — try again, or ${FORM_HINT}.`,
};
const DEFAULT_ERROR = `Couldn't understand — try again, or ${FORM_HINT}.`;

function errorMessage(code: DictationError | null): string {
  return (code && ERROR_MESSAGES[code]) || DEFAULT_ERROR;
}

/** parse-menu HTTP status → panel error code (same shapes as /api/ai/parse-drop). */
function errorForStatus(status: number, body: { error?: string }): DictationError {
  if (status === 503 || body.error === "voice_unavailable") return "voice_unavailable";
  if (status === 402) return "ai_limit";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403 || status === 404) return "not_allowed";
  return "parse_failed";
}

type BulkResponse = {
  data?: { created?: unknown[]; updated?: unknown[]; skipped?: { name: string; reason: string }[] };
  error?: string;
  issues?: { path?: (string | number)[]; message?: string }[];
};

type Saved = { summary: string; skipped: { name: string; reason: string }[] };

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `vm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Zod issues on `items.<i>.<field>` → errors on the i-th row that was sent. */
function issuesToRowErrors(rows: readonly MenuVoiceRow[], issues: BulkResponse["issues"]): Record<string, RowErrors> {
  const sent = rows.filter(isActive);
  const out: Record<string, RowErrors> = {};
  for (const issue of issues ?? []) {
    const [root, idx, field] = issue.path ?? [];
    if (root !== "items" || typeof idx !== "number" || !sent[idx]) continue;
    const key = sent[idx].key;
    const msg = issue.message || "Check this";
    const target: keyof RowErrors = field === "priceInPaise" ? "price" : field === "category" ? "category" : "name";
    out[key] = { ...out[key], [target]: msg };
  }
  return out;
}

export function VoiceMenuPanel({ voiceLang, categories, itemCount, defaultOpen = false }: VoiceMenuPanelProps) {
  const router = useRouter();
  const uid = useId().replace(/:/g, "");
  const [expanded, setExpanded] = useState(itemCount === 0 || defaultOpen);
  const [rows, setRows] = useState<MenuVoiceRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unparsed, setUnparsed] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, RowErrors>>({});
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [emojiOpenFor, setEmojiOpenFor] = useState<string | null>(null);

  const takeRef = useRef(0);
  const idemKeyRef = useRef<string>(newIdempotencyKey());
  const micRef = useRef<HTMLButtonElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const focusReview = useRef(false);
  const focusSaved = useRef(false);

  // A changed review is a different request: give it a fresh idempotency key.
  // (A retry of the same rows after a network error reuses the key.)
  useEffect(() => {
    idemKeyRef.current = newIdempotencyKey();
  }, [rows]);

  // Once the vendor has tried to save, keep the inline errors live as they type.
  useEffect(() => {
    if (attempted) setErrors(validateRows(rows));
  }, [rows, attempted]);

  const parse = useCallback(
    async (transcript: string): Promise<DictationError | void> => {
      let res: Response;
      try {
        res = await fetch("/api/ai/parse-menu", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: transcript.slice(0, 2000), lang: voiceLang }),
        });
      } catch {
        return "network_error";
      }
      const body = (await res.json().catch(() => ({}))) as { data?: MenuDraft; error?: string };
      if (!res.ok || !body.data) return errorForStatus(res.status, body);

      const draft = body.data;
      const incoming = draftToRows(draft, takeRef.current++);
      const newUnparsed = (draft.unparsed ?? []).filter((u) => typeof u === "string" && u.trim());
      if (incoming.length === 0 && newUnparsed.length === 0) return "nothing_found";

      setSaved(null);
      setSaveError(null);
      setRows((prev) => appendRows(prev, incoming));
      setWarnings((prev) => [...new Set([...prev, ...(draft.warnings ?? []).filter(Boolean)])]);
      setUnparsed((prev) => [...new Set([...prev, ...newUnparsed])]);
      focusReview.current = true;
    },
    [voiceLang],
  );

  const { state, transcript, error, start, stop, reset } = useVoiceDictation({ voiceLang, onTranscript: parse });

  useEffect(() => {
    if (focusReview.current && rows.length > 0 && state === "idle") {
      focusReview.current = false;
      reviewHeadingRef.current?.focus();
    }
  }, [rows, state]);

  useEffect(() => {
    if (saved && focusSaved.current) {
      focusSaved.current = false;
      savedRef.current?.focus();
    }
  }, [saved]);

  const online = useOnline();
  const busy = state === "transcribing" || state === "parsing";
  const offline = !online && !busy && state !== "listening";
  const counts = useMemo(() => rowCounts(rows), [rows]);
  const options = useMemo(() => categoryOptions(categories), [categories]);
  const missingPrices = rows.filter((r) => isActive(r) && "error" in parseRupeeInput(r.price)).length;
  const reviewing = rows.length > 0;

  function toggleMic() {
    if (state === "listening") {
      stop();
      return;
    }
    if (busy || offline || saving) return;
    setSaved(null);
    start();
  }

  function speakAgain() {
    micRef.current?.focus();
    toggleMic();
  }

  function patchRow(key: string, patch: Partial<MenuVoiceRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    // Server-side (400) errors on a row go away once the vendor edits that row;
    // client validation re-runs from the effect above after a save attempt.
    if (!attempted) {
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function clearReview() {
    setRows([]);
    setWarnings([]);
    setUnparsed([]);
    setErrors({});
    setAttempted(false);
    setSaveError(null);
    setEmojiOpenFor(null);
  }

  function cancel() {
    reset();
    clearReview();
    setSaved(null);
    if (itemCount > 0 && !defaultOpen) {
      setExpanded(false);
      requestAnimationFrame(() => expandRef.current?.focus());
    } else {
      micRef.current?.focus();
    }
  }

  function focusFirstError(errs: Record<string, RowErrors>) {
    const first = rows.find((r) => errs[r.key]);
    if (!first) return;
    const e = errs[first.key];
    const field = e.name ? "name" : e.price ? "price" : "category";
    document.getElementById(`${uid}-${first.key}-${field}`)?.focus();
  }

  async function save() {
    setAttempted(true);
    setSaveError(null);
    const built = buildBulkBody(rows);
    if (!built.ok) {
      setErrors(built.errors);
      focusFirstError(built.errors);
      return;
    }
    if (built.body.items.length === 0) {
      setSaveError("Tick at least one dish to save.");
      return;
    }
    if (built.body.items.length > MAX_ROWS_PER_SAVE) {
      setSaveError(`Save up to ${MAX_ROWS_PER_SAVE} dishes at a time — untick some and save the rest after.`);
      return;
    }
    setSaving(true);
    let res: Response;
    try {
      res = await fetch("/api/menu/bulk", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idemKeyRef.current },
        body: JSON.stringify(built.body),
      });
    } catch {
      setSaving(false);
      setSaveError("No internet — your dishes are still here. Try saving again.");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as BulkResponse;
    setSaving(false);

    if (res.ok && body.data) {
      const created = body.data.created?.length ?? 0;
      const updated = body.data.updated?.length ?? 0;
      focusSaved.current = true;
      setSaved({ summary: saveSummary(created, updated), skipped: body.data.skipped ?? [] });
      clearReview();
      reset();
      router.refresh();
      return;
    }
    if (res.status === 400) {
      const rowErrs = issuesToRowErrors(rows, body.issues);
      if (Object.keys(rowErrs).length > 0) {
        setAttempted(false); // server errors stay until the vendor edits
        setErrors(rowErrs);
        focusFirstError(rowErrs);
      }
      setSaveError("Some dishes couldn't be saved — check the highlighted fields.");
      return;
    }
    if (res.status === 402) {
      setSaveError(
        typeof body.error === "string" && body.error
          ? body.error
          : "Your plan's menu limit is reached — upgrade to add more dishes.",
      );
      return;
    }
    if (res.status === 409) {
      setSaveError(
        body.error === "request_in_flight"
          ? "Still saving your last try — wait a moment, then check your menu below."
          : "Your menu changed while saving — nothing was saved. Try again.",
      );
      return;
    }
    if (res.status === 429) {
      setSaveError("Too many tries — wait a minute and save again.");
      return;
    }
    if (res.status === 401 || res.status === 403) {
      setSaveError("Your account can't change the menu here.");
      return;
    }
    setSaveError("Couldn't save — your dishes are still here. Try again.");
  }

  // ── Collapsed: the menu already has dishes ──
  if (!expanded) {
    return (
      <Button
        ref={expandRef}
        type="button"
        size="lg"
        className="min-h-12 w-full gap-2 sm:w-auto"
        aria-expanded={false}
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => micRef.current?.focus());
        }}
      >
        <Mic className="h-5 w-5" aria-hidden="true" />
        Add dishes by voice
      </Button>
    );
  }

  const statusText = offline
    ? `Voice needs internet — ${FORM_HINT}.`
    : state === "listening"
      ? "Listening… tap stop when you're done."
      : busy
        ? "Working it out…"
        : state === "error"
          ? errorMessage(error)
          : reviewing
            ? "Check the dishes below, then save."
            : "Tap the mic and say each dish with its price. Add the category if you like.";

  const langLabel = LANG_LABEL[voiceLang] ?? voiceLang;
  const example = EXAMPLE[voiceLang] ?? EXAMPLE["en-IN"];
  const datalistId = `${uid}-categories`;

  return (
    <section
      aria-labelledby={`${uid}-heading`}
      aria-busy={busy || saving}
      className="space-y-4 rounded-xl border border-primary/40 bg-primary/5 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${uid}-heading`} className="font-display text-lg font-semibold">
          Add dishes by voice
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          <Mic className="h-3 w-3" aria-hidden="true" />
          <span>
            <span className="sr-only">Voice language: </span>
            {langLabel}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-4">
        <button
          ref={micRef}
          type="button"
          onClick={toggleMic}
          disabled={busy || offline || saving}
          aria-label="Speak your dishes"
          aria-pressed={state === "listening"}
          aria-describedby={`${uid}-status`}
          className={cn(
            "flex h-20 w-20 shrink-0 items-center justify-center rounded-full shadow-md ring-4 ring-offset-2 ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors",
            (state === "idle" || state === "error") && !offline && "bg-primary text-primary-foreground ring-transparent",
            offline && "cursor-not-allowed bg-muted text-muted-foreground ring-border",
            state === "listening" && "bg-destructive text-destructive-foreground ring-destructive/30 motion-safe:animate-pulse",
            busy && "cursor-wait bg-purple-600 text-white ring-purple-300 dark:bg-purple-700",
          )}
        >
          {state === "listening" ? (
            <Square className="h-8 w-8 fill-current" aria-hidden="true" />
          ) : busy ? (
            <Loader2 className="h-9 w-9 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Mic className="h-9 w-9" aria-hidden="true" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          {state === "error" || offline ? (
            <p id={`${uid}-status`} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>{statusText}</span>
            </p>
          ) : (
            <p
              id={`${uid}-status`}
              aria-live="polite"
              aria-atomic="true"
              className={cn("text-sm font-medium", state === "listening" && "text-destructive")}
            >
              {statusText}
            </p>
          )}
        </div>
      </div>

      {transcript ? (
        <div className="rounded-md border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">{state === "listening" ? "Hearing" : "We heard"}</p>
          <p className="mt-0.5 text-sm italic" lang={voiceLang}>
            &ldquo;{transcript}&rdquo;
          </p>
        </div>
      ) : !reviewing && !saved ? (
        <p className="text-xs text-muted-foreground">
          For example: <span lang={voiceLang}>&ldquo;{example}&rdquo;</span>
        </p>
      ) : null}

      {saved ? (
        <div className="space-y-2 rounded-md border border-border bg-background p-3">
          <p
            ref={savedRef}
            tabIndex={-1}
            role="status"
            className="flex items-start gap-1.5 text-sm font-semibold focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
            <span>{saved.summary}</span>
          </p>
          {saved.skipped.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium">Not saved</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {saved.skipped.map((s, i) => (
                  <li key={`${i}-${s.name}`}>
                    {s.name} — {skippedReasonText(s.reason)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {reviewing ? (
        <div className="space-y-3 rounded-md border border-border bg-background p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3
              ref={reviewHeadingRef}
              tabIndex={-1}
              className="font-display text-base font-semibold focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Check your dishes
            </h3>
            <p className="text-xs text-muted-foreground">Prices in rupees. Nothing is saved until you press Add.</p>
          </div>

          <datalist id={datalistId}>
            {options.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          {/* Column headings for the wide layout; each field keeps its own label for screen readers and mobile. */}
          <div
            aria-hidden="true"
            className="hidden gap-3 border-b border-border pb-1 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[2.75rem_minmax(0,1fr)_8rem_11rem_2.75rem]"
          >
            <span />
            <span>Dish</span>
            <span>Price (₹)</span>
            <span>Category</span>
            <span>Emoji</span>
          </div>

          <ul className="space-y-3 md:space-y-2" aria-label="Dishes heard">
            {rows.map((row, i) => (
              <ReviewRow
                key={row.key}
                row={row}
                index={i}
                idBase={`${uid}-${row.key}`}
                datalistId={datalistId}
                errors={errors[row.key]}
                emojiOpen={emojiOpenFor === row.key}
                onEmojiOpen={(open) => setEmojiOpenFor(open ? row.key : null)}
                onChange={(patch) => patchRow(row.key, patch)}
                onConvertToNew={() => {
                  setRows((prev) => prev.map((r) => (r.key === row.key ? convertToNew(r) : r)));
                  // The name is the existing dish's — the vendor will want to change it.
                  requestAnimationFrame(() => {
                    const el = document.getElementById(`${uid}-${row.key}-name`) as HTMLInputElement | null;
                    el?.focus();
                    el?.select();
                  });
                }}
                disabled={saving}
              />
            ))}
          </ul>

          {warnings.length > 0 ? (
            <div>
              <h4 className="text-sm font-medium">Please check</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm" aria-label="Things to check">
                {warnings.map((w, i) => (
                  <li key={`${i}-${w}`}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {unparsed.length > 0 ? (
            <div>
              <h4 className="text-sm font-medium">Didn&apos;t catch these</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm" aria-label="Parts we couldn't use">
                {unparsed.map((u, i) => (
                  <li key={`${i}-${u}`} lang={voiceLang}>
                    &ldquo;{u}&rdquo;
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">Speak them again, or {FORM_HINT}.</p>
            </div>
          ) : null}

          <p className="text-sm" aria-live="polite">
            {missingPrices > 0
              ? `${missingPrices} ${missingPrices === 1 ? "dish needs a price" : "dishes need a price"} before saving.`
              : null}
          </p>

          {saveError ? (
            <p role="alert" className="flex items-start gap-1.5 text-sm font-medium">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>{saveError}</span>
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="min-h-11" onClick={cancel} disabled={saving}>
              <X aria-hidden="true" />
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={speakAgain}
              disabled={saving || busy || offline}
            >
              <RotateCcw aria-hidden="true" />
              Speak again
            </Button>
            <Button
              type="button"
              className="min-h-11"
              onClick={save}
              disabled={saving || busy || counts.create + counts.update === 0}
            >
              {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {saving ? "Saving…" : primaryLabel(counts)}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

type ReviewRowProps = {
  row: MenuVoiceRow;
  index: number;
  idBase: string;
  datalistId: string;
  errors: RowErrors | undefined;
  emojiOpen: boolean;
  onEmojiOpen: (open: boolean) => void;
  onChange: (patch: Partial<MenuVoiceRow>) => void;
  onConvertToNew: () => void;
  disabled: boolean;
};

/** "Matched to Masala Chai on your menu — is that right?" + "No, add as a new dish". */
function FuzzyMatchNote({ name, onConvert, disabled }: { name: string; onConvert: () => void; disabled: boolean }) {
  return (
    <div className="col-span-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-primary/50 bg-background p-2 text-sm text-foreground md:col-span-5">
      <span className="flex min-w-[min(100%,14rem)] flex-1 items-start gap-1.5">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
          Matched to <strong>{name}</strong> on your menu — is that right?
        </span>
      </span>
      <Button type="button" variant="outline" className="min-h-11" onClick={onConvert} disabled={disabled}>
        <Plus aria-hidden="true" />
        No, add as a new dish
      </Button>
    </div>
  );
}

function ReviewRow({
  row,
  index,
  idBase,
  datalistId,
  errors,
  emojiOpen,
  onEmojiOpen,
  onChange,
  onConvertToNew,
  disabled,
}: ReviewRowProps) {
  const n = index + 1;
  const label = row.name.trim() || `dish ${n}`;
  const unchanged = row.action === "unchanged";
  const isUpdate = row.action === "update_price" && Boolean(row.existingMenuItemId);
  const priceParsed = parseRupeeInput(row.price);
  const needsPrice = !unchanged && row.selected && row.price.trim() === "";
  const errId = (f: string) => `${idBase}-${f}-err`;

  if (unchanged) {
    return (
      <li>
        <fieldset className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3 rounded-md border border-dashed border-border p-2 text-muted-foreground md:grid-cols-[2.75rem_minmax(0,1fr)_8rem_11rem_2.75rem]">
          <legend className="sr-only">Dish {n}</legend>
          <span className="flex h-11 w-11 items-center justify-center">
            <input
              type="checkbox"
              className="h-5 w-5 cursor-not-allowed accent-primary"
              checked={false}
              disabled
              aria-label={`Include ${label}`}
              aria-describedby={`${idBase}-note`}
              readOnly
            />
          </span>
          <div className="min-w-0 md:col-span-4">
            <p className="truncate text-sm font-medium text-foreground">
              <span aria-hidden="true">{row.emoji} </span>
              {row.name}
            </p>
            <p id={`${idBase}-note`} className="text-xs">
              Already on your menu
              {row.existingPriceInPaise !== null ? ` at ${formatINRCompact(row.existingPriceInPaise)}` : ""}
            </p>
          </div>
          {row.matchedFuzzy ? <FuzzyMatchNote name={row.name} onConvert={onConvertToNew} disabled={disabled} /> : null}
        </fieldset>
      </li>
    );
  }

  return (
    <li>
      <fieldset
        className={cn(
          "grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-md border p-2 md:grid-cols-[2.75rem_minmax(0,1fr)_8rem_11rem_2.75rem] md:items-start",
          needsPrice ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30" : "border-border",
          !row.selected && "opacity-70",
        )}
      >
        <legend className="sr-only">Dish {n}</legend>
        <label className="flex h-11 w-11 cursor-pointer items-center justify-center md:row-span-2">
          <input
            type="checkbox"
            className="h-5 w-5 cursor-pointer accent-primary"
            checked={row.selected}
            disabled={disabled}
            onChange={(e) => onChange({ selected: e.target.checked })}
            aria-label={`Include ${label}`}
          />
        </label>

        {/* Name (read-only for a price update: it's an existing dish) */}
        <div className="min-w-0 space-y-1">
          {isUpdate ? (
            <>
              <p className="text-xs font-medium text-muted-foreground md:sr-only">Dish</p>
              <p className="flex min-h-11 items-center text-sm font-medium">
                <span aria-hidden="true" className="mr-1">
                  {row.emoji}
                </span>
                {row.name}
              </p>
            </>
          ) : (
            <>
              <label htmlFor={`${idBase}-name`} className="text-xs font-medium text-muted-foreground md:sr-only">
                Name
              </label>
              <Input
                id={`${idBase}-name`}
                value={row.name}
                autoComplete="off"
                disabled={disabled}
                onChange={(e) => onChange({ name: e.target.value })}
                aria-invalid={errors?.name ? true : undefined}
                aria-describedby={errors?.name ? errId("name") : undefined}
                className="min-h-11"
              />
              {errors?.name ? (
                <p id={errId("name")} className="text-xs font-medium text-destructive">
                  {errors.name}
                </p>
              ) : null}
            </>
          )}
          {isUpdate ? (
            <p className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium">
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Update price {row.existingPriceInPaise !== null ? formatINRCompact(row.existingPriceInPaise) : ""} →{" "}
              {"paise" in priceParsed ? formatINRCompact(priceParsed.paise) : "?"}
            </p>
          ) : null}
          {needsPrice ? (
            <p className="inline-flex items-center gap-1 rounded-full border border-amber-500 bg-background px-2 py-0.5 text-xs font-semibold">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              Price needed
            </p>
          ) : null}
        </div>

        {/* Price */}
        <div className="col-start-2 space-y-1 md:col-start-auto">
          <label htmlFor={`${idBase}-price`} className="text-xs font-medium text-muted-foreground md:sr-only">
            Price (₹)
          </label>
          <Input
            id={`${idBase}-price`}
            value={row.price}
            inputMode="decimal"
            autoComplete="off"
            placeholder={needsPrice ? "₹ ?" : undefined}
            disabled={disabled}
            onChange={(e) => onChange({ price: e.target.value })}
            aria-invalid={errors?.price ? true : undefined}
            aria-describedby={errors?.price ? errId("price") : undefined}
            className="min-h-11"
          />
          {errors?.price ? (
            <p id={errId("price")} className="text-xs font-medium text-destructive">
              {errors.price}
            </p>
          ) : null}
        </div>

        {/* Category */}
        <div className="col-start-2 space-y-1 md:col-start-auto">
          {isUpdate ? (
            <>
              <p className="text-xs font-medium text-muted-foreground md:sr-only">Category</p>
              <p className="flex min-h-11 items-center text-sm text-muted-foreground">{row.category}</p>
            </>
          ) : (
            <>
              <label htmlFor={`${idBase}-category`} className="text-xs font-medium text-muted-foreground md:sr-only">
                Category
              </label>
              <Input
                id={`${idBase}-category`}
                value={row.category}
                list={datalistId}
                autoComplete="off"
                disabled={disabled}
                onChange={(e) => onChange({ category: e.target.value })}
                aria-invalid={errors?.category ? true : undefined}
                aria-describedby={errors?.category ? errId("category") : undefined}
                className="min-h-11"
              />
              {errors?.category ? (
                <p id={errId("category")} className="text-xs font-medium text-destructive">
                  {errors.category}
                </p>
              ) : null}
            </>
          )}
        </div>

        {/* Emoji */}
        {isUpdate ? null : (
          <div className="col-start-2 md:col-start-auto">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-input bg-background text-lg hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Emoji for ${label}: ${row.emoji}. Change`}
              aria-expanded={emojiOpen}
              aria-controls={`${idBase}-emoji`}
              disabled={disabled}
              onClick={() => onEmojiOpen(!emojiOpen)}
            >
              {row.emoji}
            </button>
          </div>
        )}

        {emojiOpen && !isUpdate ? (
          <div
            id={`${idBase}-emoji`}
            role="group"
            aria-label={`Pick an emoji for ${label}`}
            className="col-span-2 grid grid-cols-5 gap-2 sm:grid-cols-10 md:col-span-5"
          >
            {(FOOD_EMOJIS as readonly string[]).includes(row.emoji)
              ? null
              : [row.emoji].map((emo) => (
                  <EmojiOption key={emo} emo={emo} selected onPick={() => onEmojiOpen(false)} />
                ))}
            {FOOD_EMOJIS.map((emo) => (
              <EmojiOption
                key={emo}
                emo={emo}
                selected={row.emoji === emo}
                onPick={() => {
                  onChange({ emoji: emo });
                  onEmojiOpen(false);
                }}
              />
            ))}
          </div>
        ) : null}

        {isUpdate && row.matchedFuzzy ? (
          <FuzzyMatchNote name={row.name} onConvert={onConvertToNew} disabled={disabled} />
        ) : null}
      </fieldset>
    </li>
  );
}

function EmojiOption({ emo, selected, onPick }: { emo: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-11 min-w-11 items-center justify-center rounded-md border text-lg transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary bg-primary/10" : "border-input bg-background hover:bg-accent",
      )}
      aria-pressed={selected}
      aria-label={`Select emoji ${emo}`}
      onClick={onPick}
    >
      {emo}
    </button>
  );
}
