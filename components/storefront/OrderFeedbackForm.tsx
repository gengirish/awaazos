"use client";

import { Loader2, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FEEDBACK_COMMENT_MAX, RATING_WORDS } from "@/lib/order-feedback";
import { cn } from "@/lib/utils";

/**
 * "How was your order?" on a handed-over order's page: five stars as a real
 * radio group (arrow keys and screen readers work), an optional comment, one
 * send. A rating can't be changed afterwards.
 */
export function OrderFeedbackForm({
  slug,
  token,
  vendorName,
}: {
  slug: string;
  token: string;
  vendorName: string;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (rating === 0) {
      setError("Choose a rating first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment }),
      });
      if (res.ok || res.status === 409) {
        router.refresh();
        return;
      }
      setError(res.status === 429 ? "Too many tries. Please wait a minute." : "Couldn't send that. Please try again.");
    } catch {
      setError("Couldn't reach the store — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void send(e)}
      aria-labelledby="feedback-heading"
      className="space-y-3 rounded-2xl border border-border/60 bg-background p-4 shadow-xs sm:p-6"
    >
      <h2 id="feedback-heading" className="font-display text-lg font-bold text-awaaz-charcoal">
        How was your order?
      </h2>
      <fieldset>
        <legend className="sr-only">Your rating</legend>
        <div className="flex items-center gap-1">
          {RATING_WORDS.map((word, i) => {
            const value = i + 1;
            return (
              <label
                key={word}
                className="relative inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md focus-within:ring-2 focus-within:ring-primary"
              >
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  checked={rating === value}
                  onChange={() => {
                    setRating(value);
                    setError(null);
                  }}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label={`${value} out of 5: ${word}`}
                />
                <Star
                  className={cn("h-8 w-8", value <= rating ? "fill-primary text-primary" : "text-muted-foreground")}
                  aria-hidden="true"
                />
              </label>
            );
          })}
          <span className="ml-2 text-sm font-semibold" aria-hidden="true">
            {rating > 0 ? RATING_WORDS[rating - 1] : ""}
          </span>
        </div>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor="feedback-comment" className="text-sm font-semibold">
          Anything to add? (optional)
        </label>
        <textarea
          id="feedback-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={FEEDBACK_COMMENT_MAX}
          rows={2}
          className="block w-full rounded-xl border border-input bg-background px-3 py-2 text-base focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        />
        <p className="text-xs text-muted-foreground">
          Only {vendorName} sees your comment and who sent it. Your stars count towards the store&apos;s average rating.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-bold text-primary-foreground shadow-xs hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        Send feedback
      </button>
    </form>
  );
}
