"use client";

import { Loader2, MailCheck } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Storefront buyer sign-in: email in, magic link out. The API answers the same
 * way whether or not the email is known, so the success state never says
 * "account found" — only "check your email".
 */
export function CustomerSignIn({ returnTo, kitchenName }: { returnTo: string; kitchenName: string }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/s/customer/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, returnTo }),
      });
      if (res.ok) {
        setSent(true);
        return;
      }
      if (res.status === 429) setError("Too many attempts. Please wait a few minutes and try again.");
      else if (res.status === 400) setError("Enter a valid email address.");
      else setError("Something went wrong. Please try again.");
    } catch {
      setError("Couldn't connect — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div role="status" aria-live="polite" className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-5 text-center">
        <MailCheck className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
        <h2 className="mt-2 font-display text-lg font-bold text-awaaz-charcoal">Check your email</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          If <span className="font-semibold text-foreground">{email.trim()}</span> can receive mail, a sign-in
          link for {kitchenName} is on its way. It works once and expires in 15 minutes.
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setError(null);
          }}
          className="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="customer-email">Email</Label>
        <Input
          id="customer-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          required
          aria-describedby="customer-email-hint"
          aria-invalid={error ? true : undefined}
          className="h-11"
        />
        <p id="customer-email-hint" className="text-xs text-muted-foreground">
          We&apos;ll email you a sign-in link. No password needed.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : null}
        Email me a sign-in link
      </button>
    </form>
  );
}
