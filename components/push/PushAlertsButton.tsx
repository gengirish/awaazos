"use client";

import { AlertTriangle, Bell, BellOff, BellRing, Loader2, Send, Share } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";

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
import {
  PUSH_COPY as COPY,
  recheckPushAlerts,
  sendTestPushAlert,
  turnOffPushAlerts,
  turnOnPushAlerts,
  usePushAlerts,
  type PushAlertsState,
} from "@/hooks/usePushAlerts";
import { cn } from "@/lib/utils";

/**
 * "Get alerts on this phone" — Web Push opt-in for new storefront orders.
 *
 * `PushAlertsButton`
 *   `board`: compact, inside the sheet opened from the orders board's bar.
 *   `settings`: full controls for /settings/notifications (adds "Send test alert").
 * `PushAlertsBarButton`
 *   The control in the orders board's live sync bar. Instant order alerts depend
 *   on the opt-in, so until this device has it, it stays a labelled button.
 *
 * Every copy is a view over one shared store (hooks/usePushAlerts.ts): the
 * subscription is detected once per page and an action in one copy shows in
 * the others. Nothing here keeps state of its own about the subscription.
 *
 * Never prompts for notification permission except from the button click.
 * Support is detected after mount (it depends on the browser), so the server
 * render is empty and there is no hydration mismatch.
 */

type Variant = "board" | "settings";

function LiveMessage({ message }: { message: string }) {
  return (
    <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </span>
  );
}

function SubscribeButton({
  busy,
  className,
  variant,
  onStart,
}: {
  busy: PushAlertsState["busy"];
  className?: string;
  variant: "outline" | "default";
  onStart?: () => void;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      className={cn("min-h-11", className)}
      onClick={() => {
        onStart?.();
        void turnOnPushAlerts();
      }}
      disabled={busy !== null}
      aria-busy={busy === "subscribe"}
    >
      {busy === "subscribe" ? (
        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <Bell aria-hidden />
      )}
      Get alerts on this phone
    </Button>
  );
}

export function PushAlertsButton({ variant }: { variant: Variant }) {
  const { view, busy, message } = usePushAlerts();

  const isBoard = variant === "board";

  if (view === "loading") return null;
  if (view === "not-configured" && isBoard) return null;

  const live = <LiveMessage message={message} />;

  // On the board the bar's button says it, in a toast.
  const feedback =
    message && view !== "denied" && !isBoard ? (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    ) : null;

  const note = (icon: ReactNode, text: string) => (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground",
        isBoard && "basis-full",
      )}
    >
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icon}
      </span>
      <p className="min-w-0 flex-1">{text}</p>
    </div>
  );

  let body: ReactNode;
  switch (view) {
    case "not-configured":
      body = note(<BellOff className="h-4 w-4" />, COPY.notConfigured);
      break;
    case "unsupported":
      body = note(<BellOff className="h-4 w-4" />, COPY.unsupported);
      break;
    case "ios-needs-install":
      body = note(<Share className="h-4 w-4" />, COPY.iosInstall);
      break;
    case "denied":
      body = (
        <>
          {note(<AlertTriangle className="h-4 w-4" />, COPY.denied)}
          {!isBoard && (
            <Button type="button" variant="outline" className="min-h-11 self-start" onClick={recheckPushAlerts}>
              <Bell aria-hidden />
              Check again
            </Button>
          )}
        </>
      );
      break;
    case "default":
      body = (
        <>
          <SubscribeButton
            busy={busy}
            variant={isBoard ? "outline" : "default"}
            className={isBoard ? undefined : "self-start"}
          />
          {feedback}
        </>
      );
      break;
    case "subscribed":
      body = (
        <>
          <div className={cn("flex flex-wrap items-center gap-2", isBoard && "contents")}>
            <span className="inline-flex min-h-11 items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 text-sm font-medium text-foreground">
              <BellRing className="h-4 w-4" aria-hidden />
              {COPY.subscribed}
            </span>
            {!isBoard && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => void sendTestPushAlert()}
                disabled={busy !== null}
                aria-busy={busy === "test"}
              >
                {busy === "test" ? (
                  <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <Send aria-hidden />
                )}
                Send test alert
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => void turnOffPushAlerts()}
              disabled={busy !== null}
              aria-busy={busy === "unsubscribe"}
            >
              {busy === "unsubscribe" ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <BellOff aria-hidden />
              )}
              Turn off
            </Button>
          </div>
          {feedback}
        </>
      );
      break;
  }

  if (isBoard) return <div className="flex flex-wrap items-center gap-2">{body}</div>;
  return (
    <div className="flex flex-col gap-3">
      {body}
      {live}
    </div>
  );
}

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
