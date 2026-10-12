import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";

/**
 * Staff print pages (`/receipts/[bill]`): no app shell, so nothing prints
 * around the receipt. They still raise toasts (ReceiptPrintControls), and the
 * toast host is no longer in the root layout — see app/layout.tsx.
 */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster richColors position="top-center" />
    </>
  );
}
