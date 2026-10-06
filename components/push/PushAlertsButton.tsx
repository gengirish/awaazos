"use client";

import { AlertTriangle, Bell, BellOff, BellRing, Loader2, Send, Settings, Share, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  getPermission,
  getPushSupport,
  getThisDeviceSubscription,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from "@/lib/push-client";
import { cn } from "@/lib/utils";

/**
 * "Get alerts on this phone" — Web Push opt-in for new storefront orders.
 *
 * `board`: compact, sits in the orders-board header next to Refresh / Sound.
 * `settings`: full controls for /settings/notifications (adds "Send test alert").
 *
 * Never prompts for notification permission except from the button click.
 * Support is detected after mount (it depends on the browser), so the server
 * render is empty and there is no hydration mismatch.
 */

type Variant = "board" | "settings";

type View =
  | "loading"
  | "not-configured"
  | "unsupported"
  | "ios-needs-install"
  | "default"
  | "denied"
  | "subscribed";

type Busy = "subscribe" | "unsubscribe" | "test" | null;

const DISMISS_KEY = "awz_push_hint_dismissed_v1";

const COPY = {
  notConfigured: "Phone alerts aren't set up on this server yet.",
  unsupported: "This browser can't show alerts. Try Chrome on Android.",
  iosInstall:
    "On iPhone: tap Share → Add to Home Screen, then open AwaazOS from your Home Screen and turn on alerts here.",
  denied: "Alerts are blocked for this site. Allow notifications in your browser settings, then try again.",
  subscribed: "Alerts on for this phone",
  dismissedPrompt: "Alerts not turned on. Tap the button again and choose Allow.",
  failed: "Couldn't turn on alerts. Check your internet and try again.",
  tooManyDevices: "You have alerts on 10 devices already. Remove an old one in Settings → Notifications.",
  turnedOn: "Alerts turned on. New orders will show on this phone even when the screen is locked.",
  turnedOff: "Alerts turned off for this phone.",
  testSent: "Sent — check your notifications",
  testFailed: "Couldn't send a test alert. Try again.",
} as const;

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Private mode / blocked storage: the hint just comes back next visit.
  }
}

async function detectView(): Promise<View> {
  const support = getPushSupport();
  if (support !== "supported") return support;
  const permission = getPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "default";
  const sub = await getThisDeviceSubscription();
  return sub ? "subscribed" : "default";
}

export function PushAlertsButton({ variant }: { variant: Variant }) {
  const [view, setView] = useState<View>("loading");
  const [busy, setBusy] = useState<Busy>(null);
  /** Visible + announced feedback for the last action. */
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [tooMany, setTooMany] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDismissed(readDismissed());
    void detectView().then((v) => {
      if (!cancelled) setView(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const turnOn = useCallback(async () => {
    setBusy("subscribe");
    setMessage("");
    setTooMany(false);
    try {
      const res = await subscribeThisDevice();
      if (res.ok) {
        setView("subscribed");
        setMessage(COPY.turnedOn);
        return;
      }
      if (res.reason === "denied") {
        // "default" means the prompt was closed without choosing.
        if (getPermission() === "denied") {
          setView("denied");
          setMessage(COPY.denied);
        } else {
          setMessage(COPY.dismissedPrompt);
        }
      } else if (res.reason === "too_many_devices") {
        setTooMany(true);
        setMessage(COPY.tooManyDevices);
      } else if (res.reason === "unsupported" || res.reason === "not-configured") {
        setView(res.reason);
      } else {
        setMessage(COPY.failed);
      }
    } finally {
      setBusy(null);
    }
  }, []);

  const turnOff = useCallback(async () => {
    setBusy("unsubscribe");
    setMessage("");
    try {
      await unsubscribeThisDevice();
      setView(await detectView());
      setMessage(COPY.turnedOff);
    } finally {
      setBusy(null);
    }
  }, []);

  const sendTest = useCallback(async () => {
    setBusy("test");
    setMessage("");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      setMessage(res.ok ? COPY.testSent : COPY.testFailed);
    } catch {
      setMessage(COPY.testFailed);
    } finally {
      setBusy(null);
    }
  }, []);

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  const isBoard = variant === "board";

  if (view === "loading") return null;
  if (view === "not-configured" && isBoard) return null;
  if (isBoard && dismissed && (view === "ios-needs-install" || view === "unsupported")) return null;

  const live = (
    <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </span>
  );

  const feedback =
    message && view !== "denied" ? (
      <div className={cn("flex flex-wrap items-center gap-2", isBoard && "basis-full")}>
        <p className="text-sm text-muted-foreground">{message}</p>
        {tooMany && isBoard && (
          <Link
            href="/settings/notifications"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings className="h-4 w-4" aria-hidden />
            Manage devices
          </Link>
        )}
      </div>
    ) : null;

  const note = (icon: ReactNode, text: string, opts?: { dismissible?: boolean }) => (
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
      {opts?.dismissible && (
        <button
          type="button"
          onClick={dismiss}
          className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      body = note(<BellOff className="h-4 w-4" />, COPY.unsupported, { dismissible: isBoard });
      break;
    case "ios-needs-install":
      body = note(<Share className="h-4 w-4" />, COPY.iosInstall, { dismissible: isBoard });
      break;
    case "denied":
      body = (
        <>
          {note(<AlertTriangle className="h-4 w-4" />, COPY.denied)}
          {!isBoard && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 self-start"
              onClick={() => void detectView().then(setView)}
            >
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
          <Button
            type="button"
            variant={isBoard ? "outline" : "default"}
            className={cn("min-h-11", !isBoard && "self-start")}
            onClick={() => void turnOn()}
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
                onClick={() => void sendTest()}
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
              onClick={() => void turnOff()}
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
