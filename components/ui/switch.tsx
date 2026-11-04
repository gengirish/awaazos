"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A single on/off setting. Name it with a `<label htmlFor>` or `aria-label`.
 * The 48×28 px track sits inside a 56×44 px tap area, and the thumb's position
 * carries the state, not colour alone.
 */
export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "group inline-flex min-h-11 min-w-14 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className="relative inline-flex h-7 w-12 items-center rounded-full bg-switch-off transition-colors group-data-[state=checked]:bg-primary motion-reduce:transition-none"
    >
      <SwitchPrimitive.Thumb className="inline-block h-5 w-5 translate-x-1 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-6 motion-reduce:transition-none" />
    </span>
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
