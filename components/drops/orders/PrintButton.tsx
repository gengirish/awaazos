"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" variant="outline" className="min-h-11 print:hidden" onClick={() => window.print()}>
      <Printer aria-hidden />
      Print
    </Button>
  );
}
