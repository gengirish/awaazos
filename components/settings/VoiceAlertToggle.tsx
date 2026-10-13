"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
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
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={on ? "outline" : "default"}
          className="min-h-11"
          onClick={toggle}
          aria-pressed={on}
        >
          {on ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
          {on ? "Voice alert on" : "Voice alert off"}
        </Button>
        {on ? (
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => speakNewOrder()}>
            Play sample
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Says “New order received from” and the customer&apos;s first name as soon as an order comes in, while AwaazOS
        is open on this device and its volume is up. Needs alerts turned on above. With the screen locked or the app
        closed you still get the notification, but the phone can&apos;t speak it.
      </p>
    </div>
  );
}
