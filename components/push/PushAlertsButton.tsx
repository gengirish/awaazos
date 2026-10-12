"use client";

import { AlertTriangle, Bell, BellOff, BellRing, Loader2, Send, Settings, Share, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { dismissInstallHint, useInstallPrompt } from "@/hooks/useInstallPrompt";
import {
  dismissPushHint,
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
 *   `board`: compact, sits in the orders-board header next to Refresh / Sound
 *            (from md) and in the "More actions" sheet (phones).
 *   `settings`: full controls for /settings/notifications (adds "Send test alert").
 * `PushAlertsPrompt`
 *   Phones only: a dismissible row under the board header, shown only while
 *   this device has not opted in. Instant order alerts depend on the opt-in,
 *   so it must not live only inside a sheet.
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

const DISMISS_BUTTON =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

const MANAGE_DEVICES_LINK =
  "inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/**
 * iPhone, not installed: the alerts tip and the install banner give the same
 * Add-to-Home-Screen steps. One at a time, and one dismissal for both: while
 * the install banner is on screen it is the hint, and dismissing either hides
 * the other too.
 */
function useIosHintHidden(push: PushAlertsState): boolean {
  const install = useInstallPrompt();
  return push.dismissed || install.dismissed || install.bannerShowing;
}

function dismissIosHint(): void {
  dismissPushHint();
  dismissInstallHint();
}

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
  const push = usePushAlerts();
  const iosHintHidden = useIosHintHidden(push);
  const { view, busy, message, tooMany, dismissed } = push;

  const isBoard = variant === "board";

  if (view === "loading") return null;
  if (view === "not-configured" && isBoard) return null;
  if (isBoard && view === "unsupported" && dismissed) return null;
  if (isBoard && view === "ios-needs-install" && iosHintHidden) return null;

  const live = <LiveMessage message={message} />;

  const feedback =
    message && view !== "denied" ? (
      <div className={cn("flex flex-wrap items-center gap-2", isBoard && "basis-full")}>
        <p className="text-sm text-muted-foreground">{message}</p>
        {tooMany && isBoard && (
          <Link href="/settings/notifications" className={MANAGE_DEVICES_LINK}>
            <Settings className="h-4 w-4" aria-hidden />
            Manage devices
          </Link>
        )}
      </div>
    ) : null;

  const note = (icon: ReactNode, text: string, opts?: { onDismiss?: () => void }) => (
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
      {opts?.onDismiss && (
        <button
          type="button"
          onClick={opts.onDismiss}
          className={cn(DISMISS_BUTTON, "-m-2")}
          aria-label="Dismiss phone alerts tip"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );

  let body: ReactNode;
  switch (view) {
    case "not-configured":
      body = note(<BellOff className="h-4 w-4" />, COPY.notConfigured);
      break;
    case "unsupported":
      body = note(<BellOff className="h-4 w-4" />, COPY.unsupported, {
        onDismiss: isBoard ? dismissPushHint : undefined,
      });
      break;
    case "ios-needs-install":
      body = note(<Share className="h-4 w-4" />, COPY.iosInstall, {
        onDismiss: isBoard ? dismissIosHint : undefined,
      });
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

  if (isBoard) {
    return (
      <>
        {body}
        {live}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {body}
      {live}
    </div>
  );
}

/**
 * Phones only (`md:hidden`; from md the opt-in is in the board header): the
 * opt-in, on the board itself, while this device has not opted in.
 *
 *   not subscribed          the "Get alerts on this phone" button + dismiss
 *   iPhone, not installed   the Add-to-Home-Screen tip + dismiss — unless the
 *                           install banner is already giving it
 *   just subscribed here    a one-line confirmation, until the page is left
 *   anything else           nothing: subscribed, blocked, unsupported, not
 *                           configured or dismissed. Managing alerts stays in
 *                           the "More actions" sheet and in Settings.
 */
export function PushAlertsPrompt({ className }: { className?: string }) {
  const push = usePushAlerts();
  const iosHintHidden = useIosHintHidden(push);
  /**
   * The opt-in was started from this row. Once it succeeds the row has nothing
   * left to offer, so it confirms instead of vanishing under the vendor's thumb.
   * Set on the tap (not on success) so the row, and its live region, stay
   * mounted across the change.
   */
  const [startedHere, setStartedHere] = useState(false);
  const { view, busy, message, tooMany, dismissed } = push;

  let body: ReactNode = null;
  if (view === "subscribed" && startedHere) {
    body = (
      <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 py-1 pl-3 pr-1 text-sm text-foreground">
        <BellRing className="h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 py-2">{COPY.turnedOn}</p>
        <button
          type="button"
          onClick={() => setStartedHere(false)}
          className={DISMISS_BUTTON}
          aria-label="Dismiss alerts confirmation"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  } else if (view === "default" && !dismissed) {
    body = (
      <div>
        <div className="flex items-center gap-1">
          <SubscribeButton
            busy={busy}
            variant="outline"
            className="min-w-0 flex-1"
            onStart={() => setStartedHere(true)}
          />
          <button
            type="button"
            onClick={dismissPushHint}
            className={DISMISS_BUTTON}
            aria-label="Dismiss phone alerts tip"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {message ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">{message}</p>
            {tooMany ? (
              <Link href="/settings/notifications" className={MANAGE_DEVICES_LINK}>
                <Settings className="h-4 w-4" aria-hidden />
                Manage devices
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  } else if (view === "ios-needs-install" && !iosHintHidden) {
    body = (
      <div className="flex items-start gap-2 rounded-md border bg-muted/50 py-1 pl-3 pr-1 text-sm text-muted-foreground">
        <Share className="mt-2.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 py-2">{COPY.iosInstall}</p>
        <button
          type="button"
          onClick={dismissIosHint}
          className={DISMISS_BUTTON}
          aria-label="Dismiss phone alerts tip"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  if (!body) return null;
  return (
    <div data-testid="push-alerts-prompt" className={cn("md:hidden", className)}>
      {body}
      <LiveMessage message={message} />
    </div>
  );
}
