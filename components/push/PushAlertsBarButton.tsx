"use client";

import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { PushAlertsButton } from "@/components/push/PushAlertsButton";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { turnOnPushAlerts, usePushAlerts } from "@/hooks/usePushAlerts";

/**
 * The orders board's live sync bar: one tap to opt in; once on (or when the
 * browser can't), one bell that opens a sheet with what is going on and "Turn off".
 *
 *   not subscribed     "Alerts on this phone", asks for permission on the tap
 *   subscribed         a bell in its on state
 *   blocked, unsupported, iPhone not installed   a muted bell; the sheet says why
 *   not configured     nothing
 */
export function PushAlertsBarButton() {
  const { view, busy, message, tooMany } = usePushAlerts();
  const router = useRouter();

  useEffect(() => {
    if (!message) return;
    toast(
      message,
      tooMany
        ? { action: { label: "Manage devices", onClick: () => router.push("/settings/notifications") } }
        : undefined,
    );
  }, [message, tooMany, router]);

  if (view === "loading" || view === "not-configured") return null;

  if (view === "default") {
    return (
      <Button
        type="button"
        variant="ghost"
        className="px-2 md:px-3"
        onClick={() => void turnOnPushAlerts()}
        disabled={busy !== null}
        aria-busy={busy === "subscribe"}
        aria-label="Get alerts on this phone"
      >
        {busy === "subscribe" ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Bell aria-hidden />
        )}
        <span className="md:hidden">Alerts</span>
        <span className="hidden md:inline">Alerts on this phone</span>
      </Button>
    );
  }

  const on = view === "subscribed";
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={on ? "text-primary" : "text-muted-foreground"}
          aria-label={on ? "Alerts are on for this phone" : "Alerts are off for this phone"}
        >
          {on ? <BellRing aria-hidden /> : <BellOff aria-hidden />}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Alerts on this phone</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>New orders show on this phone even when the screen is locked.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <PushAlertsButton variant="board" />
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
