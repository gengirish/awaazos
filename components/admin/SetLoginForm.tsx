"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { generateHandoverPassword, handoverLoginText } from "@/lib/handover-password";

const ERROR_TEXT: Record<string, string> = {
  email_in_use: "This email already has an AwaazOS account. Send them a claim link instead, so they sign in with their own password.",
  not_a_demo_store: "This store has already been handed over.",
  not_found: "This demo store no longer exists. Refresh the page.",
  name_required: "Enter the seller's name.",
};

type Props = {
  externalRef: string;
  storeName: string;
  /** Saved earlier, so the email is filled in. */
  contactEmail: string | null;
  onCancel: () => void;
  /** After the admin has copied the login: the page refreshes and the store shows as claimed. */
  onDone: () => void;
};

/**
 * "Set up their login" on /admin/demo-stores (platform ADMIN): the admin picks the
 * seller's email and a password, and the store is handed over at once
 * (POST …/handover/login). The login is shown here once, to copy and pass on;
 * nothing is sent from our side, and the password is never stored in clear.
 */
export function SetLoginForm({ externalRef, storeName, contactEmail, onCancel, onDone }: Props) {
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(contactEmail ?? "");
  const [password, setPassword] = useState(() => generateHandoverPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Enter the seller's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter the seller's email.");
    if (password.length < 8) return setError("Use a password of at least 8 characters.");
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/demo-stores/${encodeURIComponent(externalRef)}/handover/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_name: name.trim(), owner_email: email.trim(), password, sample_orders: "archive" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string; data?: { email: string } };
      if (!res.ok || !body.data) {
        setError(
          body.error === "weak_password"
            ? (body.reason ?? "Choose a stronger password.")
            : (ERROR_TEXT[body.error ?? ""] ?? (res.status === 400 ? "Check the name, email and password." : "Could not hand it over. Try again.")),
        );
        return;
      }
      const signInUrl = `${window.location.origin}/sign-in`;
      setDone({ email: body.data.email, text: handoverLoginText({ storeName, email: body.data.email, password, signInUrl }) });
    } catch {
      setError("No connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-2" role="status">
        <p className="text-sm font-medium text-foreground">
          {storeName} now belongs to {done.email}. Pass this login on; it is shown only now.
        </p>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{done.text}</pre>
        <p className="text-xs text-muted-foreground">
          At first sign-in they go through setup and add their own UPI id. Their 30-day trial has started.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" size="sm" variant="outline" onClick={() => void copy(done.text)}>
            {copied ? "Copied" : "Copy login"}
          </Button>
          <Button type="button" size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={nameId}>Seller&apos;s name</Label>
          <Input id={nameId} className="mt-1" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} autoFocus />
        </div>
        <div>
          <Label htmlFor={emailId}>Seller&apos;s email (their username)</Label>
          <Input
            id={emailId}
            type="email"
            inputMode="email"
            autoComplete="off"
            className="mt-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>
      <div className="sm:w-1/2">
        <Label htmlFor={passwordId}>Password</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id={passwordId}
            autoComplete="new-password"
            spellCheck={false}
            className="font-mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <Button type="button" variant="outline" disabled={busy} onClick={() => setPassword(generateHandoverPassword())}>
            New
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          At least 8 characters. They can change it with &ldquo;Forgot password?&rdquo; on the sign-in page.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        The store is handed over at once: it stops being a demo, sample orders are archived and the trial starts.
      </p>
      {error ? (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Handing over…" : "Hand over with this login"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
