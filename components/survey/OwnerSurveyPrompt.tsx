"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HIDDEN_KEY = "awz_owner_survey_prompt_hidden";

const listeners = new Set<() => void>();

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function hide() {
  try {
    window.localStorage.setItem(HIDDEN_KEY, "1");
  } catch {
    // No storage: it comes back on the next visit, which is harmless.
  }
  dismissedThisPage = true;
  listeners.forEach((listener) => listener());
}

let dismissedThisPage = false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Asks an owner who hasn't answered to take the survey. The server decides who
 * sees it (`shouldAskOwnerSurvey`); "Not now" is remembered on this device, and
 * Settings still lists the survey.
 */
export function OwnerSurveyPrompt({ className }: { className?: string }) {
  const hidden = useSyncExternalStore(
    subscribe,
    () => dismissedThisPage || readHidden(),
    () => true,
  );
  if (hidden) return null;
  return (
    <aside aria-label="Owner survey" className={cn("rounded-lg border bg-card p-4 shadow-xs", className)}>
      <p className="font-medium text-foreground">What should we build for your store?</p>
      <p className="mt-1 text-sm text-muted-foreground">Tell us what is hard right now. It takes about a minute.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/settings/survey">Answer now</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={hide}>
          Not now
        </Button>
      </div>
    </aside>
  );
}
