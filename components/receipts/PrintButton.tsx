"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** `window.print()` behind a 44 px button. The browser's dialog also offers "Save as PDF". */
export function PrintButton({ children, className = "min-h-11 w-full" }: { children: ReactNode; className?: string }) {
  return (
    <Button type="button" variant="secondary" className={className} onClick={() => window.print()}>
      {children}
    </Button>
  );
}
