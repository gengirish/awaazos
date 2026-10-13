"use client";

import { useEffect } from "react";

import {
  claimAnnouncement,
  primeSpeech,
  PUSH_ARRIVED_EVENT,
  pushKindFromTag,
  pushMessageTag,
  readOrderSoundPref,
  shouldSpeakFor,
  speakNewOrder,
  type PushArrivedDetail,
} from "@/lib/order-voice";

/**
 * Speaks "New order received from customer" the moment a new-order push
 * reaches this device, on any signed-in screen (lib/order-voice.ts has the
 * rules). Renders nothing.
 *
 * It only listens: no timer, no request. The service worker posts a message
 * when a push lands; this speaks it if Sound is on for this device, then
 * re-dispatches it on `window` so an open orders board refetches straight away.
 */
export function OrderVoiceAlerts() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;

    const onMessage = (event: MessageEvent) => {
      const tag = pushMessageTag(event.data);
      const kind = tag === null ? null : pushKindFromTag(tag);
      if (tag === null || kind === null) return;
      void (async () => {
        let announced = false;
        if (shouldSpeakFor(kind) && readOrderSoundPref()) {
          // Lost the claim = another tab is saying it.
          announced = (await claimAnnouncement(tag)) ? speakNewOrder() : true;
        }
        const detail: PushArrivedDetail = { kind, announced };
        window.dispatchEvent(new CustomEvent(PUSH_ARRIVED_EVENT, { detail }));
      })();
    };
    sw.addEventListener("message", onMessage);

    // Sound was left on: unlock speech on the first tap after a reload.
    const onFirstTap = () => {
      if (readOrderSoundPref()) primeSpeech();
    };
    document.addEventListener("click", onFirstTap, { capture: true, once: true });

    return () => {
      sw.removeEventListener("message", onMessage);
      document.removeEventListener("click", onFirstTap, true);
    };
  }, []);

  return null;
}
