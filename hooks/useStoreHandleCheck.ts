"use client";

import { useEffect, useState } from "react";

import { storeHandleProblem } from "@/lib/store-handle";

/**
 * "Is this store link free?" while the owner types, for the sign-up form and
 * Settings → Online store. Rule problems are answered at once and never leave
 * the device; a well-formed handle is looked up through
 * GET /api/auth/store-handle after a short pause in typing. `current` is the
 * handle the store already has, which is always "yours".
 *
 * The answer is advice, not a reservation: the register and settings routes
 * decide on write, and the caller maps their 409 onto the field.
 */
export type StoreHandleCheck =
  | { state: "idle" }
  | { state: "invalid"; reason: string }
  | { state: "checking" }
  | { state: "yours" }
  | { state: "available" }
  | { state: "taken"; reason: string }
  | { state: "unknown" };

const DEBOUNCE_MS = 450;

export function useStoreHandleCheck(handle: string, current?: string): StoreHandleCheck {
  const [result, setResult] = useState<StoreHandleCheck>({ state: "idle" });

  useEffect(() => {
    if (!handle) {
      setResult({ state: "idle" });
      return;
    }
    if (current && handle === current) {
      setResult({ state: "yours" });
      return;
    }
    const problem = storeHandleProblem(handle);
    if (problem) {
      setResult({ state: "invalid", reason: problem });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setResult({ state: "checking" });
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/store-handle?handle=${encodeURIComponent(handle)}`, {
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!res.ok) {
          setResult({ state: "unknown" });
          return;
        }
        const body = (await res.json()) as { data?: { available: boolean; reason?: string } };
        if (cancelled) return;
        if (body.data?.available) {
          setResult({ state: "available" });
        } else {
          setResult({ state: "taken", reason: body.data?.reason ?? "That link is already taken. Try another." });
        }
      } catch {
        if (!cancelled) setResult({ state: "unknown" });
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [handle, current]);

  return result;
}
