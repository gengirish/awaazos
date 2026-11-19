"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY } from "@/lib/business-contact";
import {
  CONTACT_EMAIL_MAX,
  CONTACT_MESSAGE_MAX,
  CONTACT_MESSAGE_MIN,
  CONTACT_NAME_MAX,
  CONTACT_PHONE_MAX,
} from "@/lib/contact-message";

type Status = "idle" | "sending" | "sent" | "error";

/** The /contact form. Posts to /api/contact; rules in lib/contact-message.ts. */
export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        form.reset();
        setStatus("sent");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { issues?: { message?: string }[] };
      setError(
        res.status === 400 && body.issues?.[0]?.message
          ? body.issues[0].message
          : res.status === 429
            ? "Too many messages from this connection. Please try again in an hour, or email or call us."
            : `Your message didn't go through. Please email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE_DISPLAY}.`,
      );
      setStatus("error");
    } catch {
      setError("Could not send. Check your connection and try again.");
      setStatus("error");
    }
  }

  const sending = status === "sending";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="contact-name">Your name</Label>
        <Input
          id="contact-name"
          name="name"
          required
          maxLength={CONTACT_NAME_MAX}
          autoComplete="name"
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="contact-email">Email</Label>
        <Input
          id="contact-email"
          name="email"
          type="email"
          required
          maxLength={CONTACT_EMAIL_MAX}
          autoComplete="email"
          inputMode="email"
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="contact-phone">
          Mobile number <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="contact-phone"
          name="phone"
          type="tel"
          maxLength={CONTACT_PHONE_MAX}
          autoComplete="tel"
          inputMode="tel"
          placeholder="98765 43210"
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="contact-message">Message</Label>
        <textarea
          id="contact-message"
          name="message"
          required
          minLength={CONTACT_MESSAGE_MIN}
          maxLength={CONTACT_MESSAGE_MAX}
          rows={5}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
        />
      </div>
      {/* Honeypot: hidden from people and screen readers, filled by naive bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="space-y-2">
        <Button type="submit" disabled={sending} aria-busy={sending} className="min-h-11 w-full sm:w-auto">
          {sending ? "Sending…" : "Send message"}
        </Button>
        <div aria-live="polite">
          {status === "sent" && (
            <p role="status" className="text-sm font-medium text-foreground">
              Thanks, we&apos;ve got your message. We usually reply within one working day.
            </p>
          )}
          {status === "error" && error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
