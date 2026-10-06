/**
 * Browser side of Web Push new-order alerts. Safe to import from client
 * components: no server imports, no top-level access to `window`.
 *
 * Rules:
 *   - `subscribeThisDevice()` asks for notification permission, so call it
 *     only from a user gesture (a button click). Nothing else here prompts.
 *   - iPhone / iPad only allow web push for a site installed to the Home
 *     Screen (iOS 16.4+), hence the "ios-needs-install" state.
 *   - The push endpoint is effectively a credential: never log it.
 *
 * The pure helpers (urlBase64ToUint8Array, deviceLabel, detectPushSupport,
 * safeNotificationPath) take their inputs as arguments so they are unit
 * tested in node (lib/__tests__/push-client.test.ts).
 */

export type PushSupport = "supported" | "unsupported" | "ios-needs-install" | "not-configured";

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: "denied" | "unsupported" | "not-configured" | "too_many_devices" | "failed" };

/**
 * Fired on `window` after this device subscribes or unsubscribes, so other
 * UI (Settings → Notifications device list) can refetch.
 */
export const PUSH_CHANGED_EVENT = "awaazos:push-subscription-changed";

function announceChange(): void {
  try {
    window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
  } catch {
    // Non-browser / old browser: nothing is listening anyway.
  }
}

/** Server-side device cap (POST /api/push/subscriptions → 409 too_many_devices). */
class TooManyDevicesError extends Error {}

const SW_URL = "/sw.js";
const SW_SCOPE = "/";
const SW_READY_TIMEOUT_MS = 10_000;
const FALLBACK_PATH = "/orders";

/** Inlined at build time; empty string when push is not configured. */
function vapidPublicKey(): string {
  return (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
}

// ── Pure helpers ──────────────────────────────────────────────────────────

/** Base64url (VAPID public key) → bytes for `applicationServerKey`. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const clean = base64Url.trim();
  const padding = "=".repeat((4 - (clean.length % 4)) % 4);
  const base64 = (clean + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushEnv = {
  vapidKey: string;
  userAgent: string;
  /** navigator.maxTouchPoints — iPadOS Safari reports a Mac user agent. */
  maxTouchPoints: number;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  /** navigator.standalone (iOS) or display-mode: standalone. */
  standalone: boolean;
};

export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS 13+ Safari pretends to be desktop Safari on a Mac.
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function detectPushSupport(env: PushEnv): PushSupport {
  if (!env.vapidKey) return "not-configured";
  if (isIOS(env.userAgent, env.maxTouchPoints) && !env.standalone) return "ios-needs-install";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  return "supported";
}

/** "Chrome on Android", "Safari on iPhone", … — shown in the device list. */
export function deviceLabel(userAgent: string, maxTouchPoints = 0): string {
  const ua = userAgent;
  let os = "this device";
  if (/iPhone|iPod/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/CrOS/i.test(ua)) os = "Chromebook";
  else if (/Macintosh|Mac OS X/i.test(ua)) os = "Mac";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Browser";
  // Order matters: Edge / Samsung / Opera all also say "Chrome"; every iOS
  // browser also says "Safari".
  if (/EdgA?|EdgiOS|Edg\//i.test(ua)) browser = "Edge";
  else if (/SamsungBrowser/i.test(ua)) browser = "Samsung Internet";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/FxiOS|Firefox\//i.test(ua)) browser = "Firefox";
  else if (/CriOS|Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  return `${browser} on ${os}`;
}

/**
 * Same-origin relative path or "/orders". Mirrored in public/sw.js (which has
 * no build step); lib/__tests__/push-sw.test.ts checks both agree.
 */
export function safeNotificationPath(raw: unknown, origin: string): string {
  if (typeof raw !== "string") return FALLBACK_PATH;
  const s = raw.trim();
  if (s.charAt(0) !== "/" || s.charAt(1) === "/" || s.charAt(1) === "\\") return FALLBACK_PATH;
  try {
    const u = new URL(s, origin);
    if (u.origin !== origin) return FALLBACK_PATH;
    return u.pathname + u.search + u.hash;
  } catch {
    return FALLBACK_PATH;
  }
}

/** SHA-256 hex of the endpoint — matches `endpointHash` from GET /api/push/subscriptions. */
export async function endpointHash(endpoint: string): Promise<string> {
  const bytes = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Browser wrappers ──────────────────────────────────────────────────────

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function isStandalone(): boolean {
  if (!hasWindow()) return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  } catch {
    return false;
  }
}

export function getPushSupport(): PushSupport {
  if (!hasWindow()) return vapidPublicKey() ? "unsupported" : "not-configured";
  return detectPushSupport({
    vapidKey: vapidPublicKey(),
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    standalone: isStandalone(),
  });
}

export function getPermission(): NotificationPermission | "unsupported" {
  if (!hasWindow() || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
}

/** Resolves once the worker is active (pushManager.subscribe needs that). */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await getRegistration();
  if (reg.active) return reg;
  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("sw_ready_timeout")), SW_READY_TIMEOUT_MS);
    void navigator.serviceWorker.ready.then((r) => {
      window.clearTimeout(timer);
      resolve(r);
    });
  });
}

/** This browser's push subscription, registering /sw.js if needed. */
export async function getThisDeviceSubscription(): Promise<PushSubscription | null> {
  if (getPushSupport() !== "supported") return null;
  try {
    const reg = await getRegistration();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options?.applicationServerKey;
  if (!current) return true; // Browser does not expose it; assume ours.
  const a = new Uint8Array(current);
  if (a.length !== key.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== key[i]) return false;
  return true;
}

/**
 * Turn on alerts for this browser. MUST be called from a user gesture: the
 * permission prompt is the first thing it does.
 */
export async function subscribeThisDevice(): Promise<SubscribeResult> {
  const support = getPushSupport();
  if (support === "not-configured") return { ok: false, reason: "not-configured" };
  if (support !== "supported") return { ok: false, reason: "unsupported" };

  // Ask first, before any other await, so Safari still sees the tap.
  let permission: NotificationPermission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return { ok: false, reason: "failed" };
    }
  }
  if (permission !== "granted") return { ok: false, reason: "denied" };

  let sub: PushSubscription | null = null;
  try {
    const key = urlBase64ToUint8Array(vapidPublicKey());
    const reg = await activeRegistration();
    sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, key)) {
      // Server VAPID key was rotated: the old subscription can never be used.
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    const json = sub.toJSON();
    const res = await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
        label: deviceLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0),
      }),
    });
    if (!res.ok) {
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "too_many_devices") throw new TooManyDevicesError();
      }
      throw new Error(`subscribe_http_${res.status}`);
    }
    announceChange();
    return { ok: true };
  } catch (err) {
    // Don't leave a browser subscription the server doesn't know about.
    if (sub) await sub.unsubscribe().catch(() => false);
    return { ok: false, reason: err instanceof TooManyDevicesError ? "too_many_devices" : "failed" };
  }
}

/** Turn off alerts for this browser: server row first, then the local subscription. */
export async function unsubscribeThisDevice(): Promise<boolean> {
  const sub = await getThisDeviceSubscription();
  if (!sub) return true;
  try {
    await fetch(`/api/push/subscriptions?endpoint=${encodeURIComponent(sub.endpoint)}`, {
      method: "DELETE",
    });
  } catch {
    // Offline: the row is cleaned up on the next send (push service returns 410).
  }
  try {
    return await sub.unsubscribe();
  } catch {
    return false;
  } finally {
    announceChange();
  }
}
