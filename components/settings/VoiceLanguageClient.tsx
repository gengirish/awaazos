"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALLOWED_VOICE_LANGS, VOICE_LANGUAGES } from "@/lib/constants";

const VOICE_LANG_HINT: Record<string, string> = {
  "en-IN": "Web Speech API · works in Chrome / Edge on Android & desktop",
  "hi-IN": "Web Speech API · हिन्दी · works in Chrome / Edge on Android & desktop",
};

export type VoiceLanguageClientProps = {
  initialVoiceLang: string;
};

export function VoiceLanguageClient({ initialVoiceLang }: VoiceLanguageClientProps) {
  const initial = ALLOWED_VOICE_LANGS.includes(initialVoiceLang) ? initialVoiceLang : "en-IN";
  const [voiceLang, setVoiceLang] = useState<string>(initial);
  const [savedLang, setSavedLang] = useState<string>(initial);
  const [pending, startTransition] = useTransition();

  const dirty = voiceLang !== savedLang;

  function save() {
    if (!dirty || pending) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ voiceLang }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(body.error ?? "Could not save voice language.");
          return;
        }
        setSavedLang(voiceLang);
        const label = VOICE_LANGUAGES.find((l) => l.value === voiceLang)?.label ?? voiceLang;
        toast.success(`Voice language set to ${label}.`);
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="voice-lang-select" className="text-sm font-medium">
          Voice language
        </label>
        <Select
          value={voiceLang}
          onValueChange={(v) => setVoiceLang(v)}
          disabled={pending}
        >
          <SelectTrigger id="voice-lang-select" className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VOICE_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {VOICE_LANG_HINT[voiceLang] ?? "Speech-to-text language used by the POS mic button."}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => setVoiceLang(savedLang)}
            disabled={pending}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            Discard
          </button>
        ) : null}
      </div>
    </div>
  );
}
