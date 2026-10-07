"use client";

import { cn } from "@/lib/utils";

export type ShowOnlineSwitchProps = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Accessible name, e.g. "Show Samosa online". */
  label: string;
  id?: string;
  disabled?: boolean;
  describedBy?: string;
};

/**
 * "Show online" toggle for a menu item. Off = counter POS only, hidden from
 * the storefront. 44px tap target; state is carried by aria-checked plus the
 * visible text next to it, not by colour alone.
 */
export function ShowOnlineSwitch({ checked, onCheckedChange, label, id, disabled, describedBy }: ShowOnlineSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="group inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-10 items-center rounded-full transition-colors motion-reduce:transition-none",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform motion-reduce:transition-none",
            checked ? "translate-x-5" : "translate-x-1",
          )}
        />
      </span>
    </button>
  );
}
