"use client";

import { AlertCircle, Loader2, Mic, Plus, Square, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AddMenuItemDialog, type AddedMenuItem } from "@/components/drops/AddMenuItemDialog";
import { Button } from "@/components/ui/button";
import { useOnline } from "@/hooks/useOnline";
import { useVoiceDictation, type DictationError } from "@/hooks/useVoiceDictation";
import { voiceSummary } from "@/lib/drop-voice";
import type { DropDraft } from "@/lib/parse-drop-types";
import type { SttSource } from "@/lib/stt-source";
import { cn } from "@/lib/utils";

/** What the panel needs back from the form after it applies a draft. */
export type VoiceApplyResult = { fieldCount: number; dishCount: number; unknownItemIds: string[] };

export type VoiceDropPanelProps = {
  voiceLang: string;
  /** Edit page: applying replaces values the vendor already saved. */
  isEdit?: boolean;
  /** Merge the draft into the form (never saves). */
  onDraft: (draft: DropDraft) => VoiceApplyResult;
  /** Restore the form as it was before the last voice take. */
  onUndo: () => void;
  canUndo: boolean;
  /** A spoken dish was added to the menu from here: tick it in the form with the spoken quantity. */
  onMenuItemAdded: (item: AddedMenuItem, quantity: number | null) => void;
  /** Owners get a link to billing when voice is paused by the billing lock. */
  canManageBilling?: boolean;
};

const LANG_LABEL: Record<string, string> = {
  "en-IN": "English",
  "hi-IN": "हिन्दी (Hindi)",
  "te-IN": "తెలుగు (Telugu)",
  "kn-IN": "ಕನ್ನಡ (Kannada)",
  "ta-IN": "தமிழ் (Tamil)",
};

/** One sentence in the way a home cook would say it in that language (romanised). */
const EXAMPLE: Record<string, string> = {
  "en-IN": "Tomorrow, 20 ragi laddu at 150 rupees, 15 thepla, pickup 6 to 8 in the evening, orders till 4.",
  "hi-IN": "Aaj ke liye 20 ragi laddu 150 rupaye, 15 thepla, pickup shaam 6 se 8 baje, order 4 baje tak.",
  "te-IN": "Repu 20 ragi laddu 150 rupayalu, 15 thepla, pickup saayantram 6 nundi 8 varaku, order 4 varaku.",
  "kn-IN": "Naale 20 ragi laddu 150 rupayi, 15 thepla, pickup sanje 6 rinda 8 varege, order 4 gante varege.",
  "ta-IN": "Naalai 20 ragi laddu 150 roobai, 15 thepla, pickup maalai 6 muthal 8 varai, order 4 mani varai.",
};

const FORM_HINT = "fill the form below";

const ERROR_MESSAGES: Record<string, string> = {
  voice_unavailable: `Voice isn't available right now — ${FORM_HINT}.`,
  ai_limit: `Voice limit reached for your plan — ${FORM_HINT}.`,
  billing_locked: "Voice is paused until you subscribe. You can still fill in the form.",
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
  nothing_found: `Couldn't find drop details in that — try again or ${FORM_HINT}.`,
};
const DEFAULT_ERROR = `Couldn't understand — try again or ${FORM_HINT}.`;

function errorMessage(code: DictationError | null): string {
  return (code && ERROR_MESSAGES[code]) || DEFAULT_ERROR;
}

/** parse-drop HTTP status → panel error code (shapes mirror /api/ai/parse-order). */
function errorForStatus(status: number, body: { error?: string }): DictationError {
  if (status === 503 || body.error === "voice_unavailable") return "voice_unavailable";
  // 402 is two different things: the billing lock, or a plan / usage cap.
  if (status === 402) return body.error === "billing_locked" ? "billing_locked" : "ai_limit";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403 || status === 404) return "not_allowed";
  return "parse_failed";
}

type Unmatched = { key: string; spokenName: string; quantity?: number | null };
type Result = { summary: string; warnings: string[]; unmatched: Unmatched[] };

export function VoiceDropPanel({
  voiceLang,
  isEdit = false,
  onDraft,
  onUndo,
  canUndo,
  onMenuItemAdded,
  canManageBilling = false,
}: VoiceDropPanelProps) {
  const [result, setResult] = useState<Result | null>(null);
  const [adding, setAdding] = useState<Unmatched | null>(null);
  const [undone, setUndone] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const focusSummary = useRef(false);

  const onDraftRef = useRef(onDraft);
  useEffect(() => {
    onDraftRef.current = onDraft;
  }, [onDraft]);

  const parse = useCallback(
    async (transcript: string, sttSource: SttSource): Promise<DictationError | void> => {
      let res: Response;
      try {
        res = await fetch("/api/ai/parse-drop", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          // The route caps transcripts at 1000 chars; a 30 s take is well under that.
          body: JSON.stringify({ transcript: transcript.slice(0, 1000), lang: voiceLang, sttSource }),
        });
      } catch {
        return "network_error";
      }
      const body = (await res.json().catch(() => ({}))) as { data?: DropDraft; error?: string };
      if (!res.ok || !body.data) return errorForStatus(res.status, body);

      const draft = body.data;
      const applied = onDraftRef.current(draft);
      const unmatched = (draft.unmatched ?? []).map((u, i) => ({ ...u, key: `${i}-${u.spokenName}` }));
      const warnings = [...(draft.warnings ?? [])];
      for (const it of draft.items ?? []) {
        if (it.matchedByName) warnings.push(`Picked “${it.name}” from your menu by name — check it's the right dish.`);
      }
      if (applied.unknownItemIds.length > 0) {
        warnings.push("Some dishes weren't on your menu and were left out — check the item list.");
      }
      if (applied.fieldCount === 0 && applied.dishCount === 0 && unmatched.length === 0) {
        return "nothing_found";
      }
      focusSummary.current = true;
      setUndone(false);
      setResult({ summary: voiceSummary(applied.fieldCount, applied.dishCount), warnings, unmatched });
    },
    [voiceLang],
  );

  const { state, transcript, error, start, stop } = useVoiceDictation({ voiceLang, onTranscript: parse });

  // After results land, move focus to the summary so screen-reader and keyboard
  // users start reviewing from there.
  useEffect(() => {
    if (result && focusSummary.current) {
      focusSummary.current = false;
      summaryRef.current?.focus();
    }
  }, [result]);

  const online = useOnline();
  const busy = state === "transcribing" || state === "parsing";
  const offline = !online && !busy && state !== "listening";

  function toggle() {
    if (state === "listening") {
      stop();
      return;
    }
    if (busy || offline) return;
    setResult(null);
    setUndone(false);
    start();
  }

  function menuItemAdded(item: AddedMenuItem) {
    if (!adding) return;
    onMenuItemAdded(item, adding.quantity ?? null);
    const key = adding.key;
    setAdding(null);
    // The row (and the button that opened the dialog) goes away: review continues from the summary.
    focusSummary.current = true;
    setResult((r) => (r ? { ...r, unmatched: r.unmatched.filter((x) => x.key !== key) } : r));
  }

  function undo() {
    onUndo();
    setResult(null);
    setUndone(true);
    micRef.current?.focus();
  }

  const statusText = offline
    ? `Voice needs internet — ${FORM_HINT}.`
    : state === "listening"
      ? "Listening… tap stop when you're done."
      : busy
        ? "Working it out…"
        : state === "error"
          ? errorMessage(error)
          : undone
            ? "Voice changes undone."
            : result
              ? "Done — check the form below."
              : "Tap the mic and say what you're cooking, how many, the price and the timings.";

  const langLabel = LANG_LABEL[voiceLang] ?? voiceLang;
  const example = EXAMPLE[voiceLang] ?? EXAMPLE["en-IN"];

  return (
    <section
      aria-labelledby="voice-drop-heading"
      aria-busy={busy}
      className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-3 md:space-y-4 md:p-4"
    >
      {/*
        Phones: the mic sits beside the heading and the status line (one block
        instead of two stacked rows), so the form starts sooner. From md: the
        heading row on top, mic and status under it. Same DOM order either way
        (heading, note, mic, status); only the grid placement changes.
      */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 md:gap-x-4 md:gap-y-4">
        <div className="col-start-2 row-start-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 md:col-span-2 md:col-start-1">
          <h2 id="voice-drop-heading" className="font-display text-lg font-semibold leading-tight">
            Fill this form by voice
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            <Mic className="h-3 w-3" aria-hidden="true" />
            <span>
              <span className="sr-only">Voice language: </span>
              {langLabel}
            </span>
          </span>
        </div>

        {isEdit ? (
          <p className="col-span-2 row-start-3 flex items-start gap-1.5 text-xs text-muted-foreground md:row-start-2 md:text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Voice replaces the values you say in the form below. Nothing is saved until you press Save changes.
            </span>
          </p>
        ) : null}

        <button
          ref={micRef}
          type="button"
          onClick={toggle}
          disabled={busy || offline}
          aria-label="Speak your drop"
          aria-pressed={state === "listening"}
          aria-describedby="voice-drop-status"
          className={cn(
            "col-start-1 row-span-2 row-start-1 flex h-20 w-20 shrink-0 items-center justify-center rounded-full shadow-md ring-4 ring-offset-2 ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors",
            isEdit ? "md:row-span-1 md:row-start-3" : "md:row-span-1 md:row-start-2",
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

        <div className={cn("col-start-2 row-start-2 min-w-0 self-start md:self-center", isEdit && "md:row-start-3")}>
          {state === "error" || offline ? (
            <p
              id="voice-drop-status"
              role="alert"
              className="flex items-start gap-1.5 text-sm font-medium text-foreground"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>{statusText}</span>
            </p>
          ) : null}
          {state === "error" && error === "billing_locked" && canManageBilling && !offline ? (
            <Link
              href="/settings/billing"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-2"
            >
              Choose a plan
            </Link>
          ) : null}
          {state === "error" || offline ? null : (
            <p
              id="voice-drop-status"
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
          <p className="text-xs font-medium text-muted-foreground">
            {state === "listening" ? "Hearing" : "We heard"}
          </p>
          <p className="mt-0.5 text-sm italic" lang={voiceLang}>
            &ldquo;{transcript}&rdquo;
          </p>
        </div>
      ) : (
        // Phones, before the first tap: one line of the example is enough to show
        // the pattern. The whole sentence shows once the cook starts speaking.
        <p className={cn("text-xs text-muted-foreground", state === "idle" && "max-md:line-clamp-1")}>
          For example: <span lang={voiceLang}>&ldquo;{example}&rdquo;</span>
        </p>
      )}

      {result ? (
        <div className="space-y-3 rounded-md border border-border bg-background p-3">
          <p ref={summaryRef} tabIndex={-1} className="text-sm font-semibold focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
            {result.summary}
          </p>

          {result.warnings.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium">Please check</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {result.warnings.map((w, i) => (
                  <li key={`${i}-${w}`}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.unmatched.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium">Not on your menu</h3>
              <ul className="mt-1 space-y-2" aria-label="Dishes not on your menu">
                {result.unmatched.map((u) => (
                  <li key={u.key} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                    <span className="min-w-0 flex-1 text-sm">
                      {u.spokenName}
                      {u.quantity ? <span className="text-muted-foreground"> · {u.quantity}</span> : null}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      aria-label={`Add ${u.spokenName} to menu`}
                      onClick={() => setAdding(u)}
                    >
                      <Plus aria-hidden="true" />
                      <span aria-hidden="true">Add to menu</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 min-w-11"
                      aria-label={`Remove ${u.spokenName}`}
                      onClick={() =>
                        setResult((r) => (r ? { ...r, unmatched: r.unmatched.filter((x) => x.key !== u.key) } : r))
                      }
                    >
                      <X aria-hidden="true" />
                      <span aria-hidden="true">Remove</span>
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                Add to menu saves the dish and ticks it in the item list below, with the quantity you said.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {adding ? (
        <AddMenuItemDialog
          key={adding.key}
          spokenName={adding.spokenName}
          onClose={() => setAdding(null)}
          onAdded={menuItemAdded}
        />
      ) : null}

      {canUndo ? (
        <Button type="button" variant="outline" className="min-h-11" onClick={undo}>
          <Undo2 aria-hidden="true" />
          Undo voice changes
        </Button>
      ) : null}
    </section>
  );
}
