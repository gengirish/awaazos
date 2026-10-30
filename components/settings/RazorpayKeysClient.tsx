"use client";

import { Check, Copy, Lock } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Vendor connects HER OWN Razorpay account so storefront buyers can pay online
 * and orders are marked paid automatically. Money settles into her Razorpay
 * account — AwaazOS never holds it.
 *
 * Two ways in, one at a time:
 * - "Connect Razorpay" (OAuth, when the partner app is configured): a full-page
 *   link to /api/vendor/payments/razorpay/connect; Razorpay sends her back here
 *   with `?razorpay=<outcome>`. Nothing to copy.
 * - API keys + a webhook she creates herself ("Use API keys instead").
 *
 * Secrets are write-only: inputs start empty, are sent once over PUT, and the
 * API never returns them. After saving we only know the method, the last 4 of
 * the public key id or the Razorpay account id.
 */
export type RazorpayMethod = "keys" | "oauth" | null;

export type RazorpayKeysClientProps = {
  initialMethod: RazorpayMethod;
  initialKeyIdLast4: string | null;
  accountId: string | null;
  oauthMode: "test" | "live" | null;
  /** Connected by OAuth but the refresh token ran out: online pay is off until she reconnects. */
  needsReconnect: boolean;
  oauthAvailable: boolean;
  /** `?razorpay=` from the Connect flow's redirect back. */
  outcome: string | null;
  webhookUrl: string;
  planEligible: boolean;
  encryptionConfigured: boolean;
  isOwner: boolean;
};

const CONNECT_HREF = "/api/vendor/payments/razorpay/connect";

const KEY_ID = /^rzp_(live|test)_[A-Za-z0-9]{8,32}$/;

const OUTCOMES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Razorpay connected. Customers can now pay online.", ok: true },
  denied: { text: "You cancelled on Razorpay, so nothing changed.", ok: false },
  expired: {
    text: "That link expired or was opened in another browser. Tap Connect Razorpay again.",
    ok: false,
  },
  upgrade: { text: "Online payments are on the Starter plan.", ok: false },
  owner_only: { text: "Only the owner of this store can connect Razorpay.", ok: false },
  unavailable: { text: "Connect Razorpay isn't switched on for AwaazOS yet. Please use API keys.", ok: false },
  error: { text: "Couldn't connect to Razorpay. Please try again in a minute.", ok: false },
};

const inputClass =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-base ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const primaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const linkBtn =
  "inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

export function RazorpayKeysClient({
  initialMethod,
  initialKeyIdLast4,
  accountId,
  oauthMode,
  needsReconnect,
  oauthAvailable,
  outcome,
  webhookUrl,
  planEligible,
  encryptionConfigured,
  isOwner,
}: RazorpayKeysClientProps) {
  const [method, setMethod] = useState<RazorpayMethod>(initialMethod);
  const [last4, setLast4] = useState(initialKeyIdLast4);
  // The keys form shows by default only when there's no Connect button to offer.
  const [editing, setEditing] = useState(initialMethod === null && !oauthAvailable);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsUpgrade, setNeedsUpgrade] = useState(!planEligible);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [outcomeShown, setOutcomeShown] = useState(outcome);
  const [pending, startTransition] = useTransition();

  const configured = method !== null;
  const outcomeMsg = outcomeShown ? OUTCOMES[outcomeShown] ?? OUTCOMES.error : null;

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the URL and copy it manually.");
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const id = keyId.trim();
    if (!KEY_ID.test(id)) {
      setError("Key ID starts with rzp_live_ (or rzp_test_ for testing). Copy it from Razorpay → API Keys.");
      return;
    }
    if (keySecret.trim().length < 8) {
      setError("Paste the Key Secret shown when you generated the key.");
      return;
    }
    if (webhookSecret.trim().length < 8) {
      setError("Enter the webhook secret you typed when creating the webhook (at least 8 characters).");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor/payments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ keyId: id, keySecret: keySecret.trim(), webhookSecret: webhookSecret.trim() }),
        });
        if (res.ok) {
          const json = (await res.json()) as { data: { keyIdLast4: string | null } };
          setMethod("keys");
          setLast4(json.data.keyIdLast4);
          setEditing(false);
          setOutcomeShown(null);
          setKeyId("");
          setKeySecret("");
          setWebhookSecret("");
          toast.success("Razorpay connected. Customers can now pay online.");
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 402) setNeedsUpgrade(true);
        else if (data.error === "invalid_razorpay_keys")
          setError("Razorpay rejected these keys. Check the Key ID and Key Secret, and that they are from the same mode (live/test).");
        else if (data.error === "payments_not_configured")
          setError("Online payments aren't switched on for AwaazOS yet. Please contact support.");
        else if (data.error === "razorpay_unreachable")
          setError("Couldn't reach Razorpay to check your keys. Please try again in a minute.");
        else if (res.status === 403) setError("Only the owner can change payment settings.");
        else if (res.status === 429) setError("Too many attempts. Please wait a minute.");
        else setError("Couldn't save. Please try again.");
      } catch {
        setError("Network error — please try again.");
      }
    });
  }

  function remove() {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor/payments", { method: "DELETE", credentials: "include" });
        if (!res.ok) {
          toast.error("Couldn't disconnect. Please try again.");
          return;
        }
        setMethod(null);
        setLast4(null);
        setEditing(!oauthAvailable);
        setConfirmRemove(false);
        setOutcomeShown(null);
        toast.success("Razorpay disconnected. Customers will pay by UPI QR instead.");
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  const explainer = (
    <p className="text-sm text-muted-foreground">
      Customers pay by UPI, card or netbanking on your store page and the order is marked paid automatically.
      The money goes straight into <strong className="font-semibold text-foreground">your own Razorpay account</strong>{" "}
      — AwaazOS never touches it. Razorpay&apos;s own fees apply.
    </p>
  );

  if (needsUpgrade) {
    return (
      <div className="space-y-4">
        {explainer}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Online payments are on the Starter plan.
          </p>
          <Link href="/settings/billing" className={primaryBtn}>
            Subscribe to Starter
          </Link>
        </div>
      </div>
    );
  }

  const statusLine =
    method === "oauth"
      ? `Connected to Razorpay account ${accountId ?? ""}${oauthMode === "test" ? " (test mode)" : ""}`
      : method === "keys"
        ? `Connected — key ending …${last4 ?? "????"}`
        : null;

  if (!isOwner) {
    return (
      <div className="space-y-3">
        {explainer}
        <p className="text-sm font-medium">
          {statusLine ? `${statusLine}.` : "Not connected."} Only the owner can change this.
        </p>
      </div>
    );
  }

  if (!encryptionConfigured) {
    return (
      <div className="space-y-3">
        {explainer}
        <p className="text-sm text-amber-700">
          Online payments aren&apos;t switched on for AwaazOS yet. Please contact support.
        </p>
      </div>
    );
  }

  const connectButton = (label: string, primary: boolean) => (
    // A plain link, not fetch: the browser has to leave for Razorpay and come back.
    <a href={CONNECT_HREF} className={primary ? primaryBtn : secondaryBtn}>
      {label}
    </a>
  );

  return (
    <div className="space-y-5">
      {explainer}

      {outcomeMsg ? (
        <p
          role={outcomeMsg.ok ? "status" : "alert"}
          className={outcomeMsg.ok ? "text-sm font-medium text-success" : "text-sm font-medium text-destructive"}
        >
          {outcomeMsg.text}
        </p>
      ) : null}

      <div className="space-y-2" aria-live="polite">
        {statusLine ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <Check className="h-4 w-4" aria-hidden="true" />
            {statusLine}
          </p>
        ) : (
          <p className="text-sm font-medium">Not connected. Customers pay by UPI QR and you confirm by hand.</p>
        )}
        {method === "oauth" && needsReconnect ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            Your Razorpay connection has expired, so customers can&apos;t pay online. Tap Reconnect Razorpay.
          </p>
        ) : null}
      </div>

      {method === "oauth" ? (
        <div className="flex flex-wrap gap-2">
          {needsReconnect ? connectButton("Reconnect Razorpay", true) : null}
          {confirmRemove ? (
            <>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {pending ? "Disconnecting…" : "Yes, disconnect"}
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)} className={secondaryBtn}>
                Keep connected
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmRemove(true)} className={secondaryBtn}>
              Disconnect
            </button>
          )}
        </div>
      ) : null}

      {method === null && oauthAvailable && !editing ? (
        <div className="space-y-3">
          {connectButton("Connect Razorpay", true)}
          <p className="text-xs text-muted-foreground">
            You&apos;ll sign in to Razorpay and approve AwaazOS. Nothing to copy or paste. You need a Razorpay account
            with KYC done to take real payments.
          </p>
          <button type="button" onClick={() => setEditing(true)} className={linkBtn}>
            Use API keys instead
          </button>
        </div>
      ) : null}

      {method === "keys" || editing ? (
        <>
          {method === "keys" && oauthAvailable ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Easier: connect your Razorpay account directly. Afterwards you can delete the webhook you made in Razorpay.
              </p>
              {connectButton("Switch to Connect Razorpay", false)}
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium" id="rzp-webhook-label">
              Webhook URL
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={webhookUrl}
                aria-labelledby="rzp-webhook-label"
                onFocus={(e) => e.currentTarget.select()}
                className={`${inputClass} text-sm`}
              />
              <button type="button" onClick={copyWebhook} className={secondaryBtn}>
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>
                In Razorpay Dashboard go to <strong>Account &amp; Settings → API Keys</strong> and generate a key. Copy
                the Key ID and Key Secret.
              </li>
              <li>
                Go to <strong>Webhooks → Add New Webhook</strong>, paste the URL above, type any secret you like, and
                tick the events <strong>payment.captured</strong> and <strong>order.paid</strong>.
              </li>
              <li>Paste all three below and save. Keep payment auto-capture on (Razorpay&apos;s default).</li>
            </ol>
          </div>

          {editing ? (
            <form onSubmit={save} className="space-y-3" noValidate>
              <div className="space-y-1">
                <label htmlFor="rzp-key-id" className="text-sm font-medium">
                  Key ID
                </label>
                <input
                  id="rzp-key-id"
                  autoComplete="off"
                  spellCheck={false}
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder="rzp_live_…"
                  maxLength={48}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="rzp-key-secret" className="text-sm font-medium">
                  Key Secret
                </label>
                <input
                  id="rzp-key-secret"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={keySecret}
                  onChange={(e) => setKeySecret(e.target.value)}
                  maxLength={128}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="rzp-webhook-secret" className="text-sm font-medium">
                  Webhook secret
                </label>
                <input
                  id="rzp-webhook-secret"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  maxLength={128}
                  className={inputClass}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Stored encrypted. We check the keys with Razorpay before saving and never show them again.
              </p>
              {error ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending} aria-busy={pending} className={primaryBtn}>
                  {pending ? "Checking with Razorpay…" : configured ? "Save new keys" : "Save keys"}
                </button>
                {configured || oauthAvailable ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setError(null);
                    }}
                    className={secondaryBtn}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(true)} className={secondaryBtn}>
                Replace keys
              </button>
              {confirmRemove ? (
                <>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={pending}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    {pending ? "Disconnecting…" : "Yes, disconnect"}
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(false)} className={secondaryBtn}>
                    Keep connected
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmRemove(true)} className={secondaryBtn}>
                  Disconnect
                </button>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
