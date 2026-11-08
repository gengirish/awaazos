import * as React from "react";

import { cn } from "@/lib/utils";

export type RadioOptionProps = Omit<React.ComponentPropsWithoutRef<"input">, "type" | "size" | "children"> & {
  /** The visible text, which is also the radio's accessible name. */
  label: React.ReactNode;
  /** A second, quieter line under the label. */
  hint?: React.ReactNode;
  /** `compact` is for segmented rows in tight spots: POS payment mode, board filters. */
  size?: "default" | "compact";
  invalid?: boolean;
  /** Classes for the outer label; the input takes the rest of the props. */
  className?: string;
  inputClassName?: string;
};

/**
 * One choice of a pick-one group: a native radio inside its label, so the whole
 * card is the tap target and arrow keys move within the group for free. Give
 * every option in a group the same `name`, and wrap them in a `<fieldset>` with
 * a `<legend>` (or `role="radiogroup"` with a label). The dot and the border
 * carry the selected state, not colour alone.
 */
export const RadioOption = React.forwardRef<HTMLInputElement, RadioOptionProps>(
  ({ label, hint, size = "default", invalid, className, inputClassName, checked, ...inputProps }, ref) => {
    const compact = size === "compact";
    return (
      // `relative`: a visually hidden input (`inputClassName="sr-only"`) is placed inside the label,
      // not wherever the nearest positioned ancestor is, so focus and taps never scroll the page away.
      <label
        className={cn(
          "relative flex min-h-11 cursor-pointer rounded-xl border text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-not-allowed has-disabled:opacity-50",
          compact ? "items-center justify-center gap-1.5 px-1.5 py-1" : "gap-3 px-3 py-2.5",
          !compact && (hint ? "items-start" : "items-center"),
          checked ? "border-primary bg-primary/10 font-semibold" : invalid ? "border-destructive" : "border-input bg-background",
          className,
        )}
      >
        <input
          ref={ref}
          type="radio"
          checked={checked}
          className={cn("h-4 w-4 shrink-0 accent-primary", hint && "mt-0.5", inputClassName)}
          {...inputProps}
        />
        {hint ? (
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">{label}</span>
            <span className="text-xs font-normal text-muted-foreground">{hint}</span>
          </span>
        ) : (
          <span className="min-w-0">{label}</span>
        )}
      </label>
    );
  },
);
RadioOption.displayName = "RadioOption";
