"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * "Back" in the store header's pill row. Shown only when this tab has a page
 * to go back to, read after mount so the server HTML and first render match.
 * A buyer who opened the link straight from Instagram or WhatsApp has none
 * (their app's own close button takes them back), so nothing is shown.
 */
export function StoreBackButton() {
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, []);

  if (!canGoBack) return null;
  return (
    <button
      type="button"
      onClick={() => window.history.back()}
      aria-label="Back"
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-3 text-xs font-semibold text-foreground shadow-xs transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">Back</span>
    </button>
  );
}
