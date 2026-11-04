"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  canSpeak,
  readOrderSoundPref,
  speakNewOrder,
  writeOrderSoundPref,
} from "@/lib/order-voice";

/**
 * Settings → Notifications: the spoken new-order alert for this device. The
 * same per-device choice as the orders board's Sound button
 * (lib/order-voice.ts), on until turned off. Read after mount, so the server
 * render is empty.
 */
export function VoiceAlertToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(canSpeak());
    setOn(readOrderSoundPref());
  }, []);

  if (on === null) return null;

  if (!supported) {
    return <p className="text-sm text-muted-foreground">This browser can&apos;t speak alerts. Try Chrome on Android.</p>;
  }

  const toggle = () => {
    const next = !on;
    // Inside the tap: lets the vendor hear it, and unlocks speech on iOS.
    if (next) speakNewOrder();
    setOn(next);
    writeOrderSoundPref(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label htmlFor="voice-alert-toggle" className="text-sm font-medium">
            Voice alert on this device
          </label>
          <p className="text-sm text-muted-foreground">
            Says “New order received from” and the customer&apos;s first name as soon as an order comes in, while AwaazOS
            is open on this device and its volume is up. Needs alerts turned on above. With the screen locked or the app
            closed you still get the notification, but the phone can&apos;t speak it.
          </p>
        </div>
        <Switch id="voice-alert-toggle" checked={on} onCheckedChange={toggle} />
      </div>
      {on ? (
        <div>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => speakNewOrder()}>
            Play sample
          </Button>
        </div>
      ) : null}
    </div>
  );
}
