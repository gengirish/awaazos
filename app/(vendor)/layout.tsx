import type { ReactNode } from "react";

import { OrderVoiceAlerts } from "@/components/push/OrderVoiceAlerts";
import { AppShell } from "@/components/shell/AppShell";
import { Toaster } from "@/components/ui/sonner";

import { getShellContext } from "./_shell-context";

/**
 * Signed-in vendor area: every page here renders inside the app shell
 * (persistent navigation — bottom tabs on phones, a rail from md up).
 *
 * The shell is navigation only. Each page still authorises itself with
 * `requireVendorRole(minRole)`; the lookups behind it are request-cached in
 * lib/rbac.ts, so layout and page share them. Signed out → /sign-in.
 *
 * Pages that must print without any chrome live outside this group:
 * `/receipts/[bill]` is in app/(print)/.
 *
 * The toast host is here (and in app/(print)/layout.tsx), not in the root
 * layout: only signed-in screens raise toasts, and public pages should not
 * download sonner.
 */
export default async function VendorLayout({ children }: { children: ReactNode }) {
  const { vendor, role, storePath } = await getShellContext();
  return (
    <>
      <AppShell role={role} vendorId={vendor.id} vendorName={vendor.name} storePath={storePath}>
        {children}
      </AppShell>
      <Toaster richColors position="top-center" />
      <OrderVoiceAlerts />
    </>
  );
}
