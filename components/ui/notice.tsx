import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

const TONE = {
  warning: "border-amber-500/60 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  danger: "border-destructive/50 bg-destructive/10 text-destructive",
} as const;

export type NoticeProps = React.HTMLAttributes<HTMLDivElement> & {
  /** `warning`: something to fix or know before going on. `danger`: the action failed. */
  tone?: keyof typeof TONE;
  /** Leading warning triangle, for a notice that has to be noticed among other content. */
  icon?: boolean;
};

/**
 * Boxed inline message for a blocked or failed action, placed next to the
 * control it is about. A one-line field error stays plain `text-destructive`
 * text under its input.
 *
 * It sets no role: pass `role="alert"` when it appears in response to an
 * action, so screen readers announce it.
 */
export function Notice({ tone = "warning", icon = false, className, children, ...props }: NoticeProps) {
  return (
    <div className={cn("rounded-md border p-3 text-sm", icon && "flex gap-2", TONE[tone], className)} {...props}>
      {icon ? (
        <>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}
