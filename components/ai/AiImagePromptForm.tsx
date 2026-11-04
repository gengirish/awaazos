"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MAX_PROMPT = 300;

/** The description box shared by the banner and story AI images. */
export function AiImagePromptForm({
  label,
  placeholder,
  submitLabel,
  busy,
  disabled,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
  onSubmit: (prompt: string) => void;
}) {
  const id = useId();
  const hintId = useId();
  const [prompt, setPrompt] = useState("");
  const trimmed = prompt.trim();

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed.length >= 3 && !busy) onSubmit(trimmed);
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={prompt}
        maxLength={MAX_PROMPT}
        disabled={disabled || busy}
        placeholder={placeholder}
        aria-describedby={hintId}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        Made by AI from your words, so check it before you use it. Leave out names and phone numbers.
      </p>
      <Button type="submit" variant="outline" disabled={disabled || busy || trimmed.length < 3}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
        {submitLabel}
      </Button>
    </form>
  );
}
