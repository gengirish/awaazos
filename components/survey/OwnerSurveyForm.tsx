"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  OWNER_PAINS,
  painLabel,
  PUBLIC_SURVEY_NOTICE,
  SURVEY_COMMENT_MAX,
  SURVEY_USE_NOTICE,
  WEEKLY_ORDER_BANDS,
  WILLING_TO_PAY_BANDS,
  type OwnerSurveyAnswers,
} from "@/lib/owner-survey";
import { cn } from "@/lib/utils";

const CHOICE =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring";

const LEGEND = "font-medium text-foreground";

function RadioChoices({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: readonly { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <fieldset>
      <legend className={LEGEND}>{legend}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.key} className={CHOICE}>
            <input
              type="radio"
              name={name}
              value={o.key}
              checked={value === o.key}
              onChange={() => onChange(o.key)}
              className="h-4 w-4 shrink-0"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The owner survey. Answering again replaces the store's answers
 * (PUT /api/vendor/survey). The notice above the questions says what they are
 * used for, including price: keep it there.
 *
 * With `isPublic` (the /survey page) nobody is signed in: the answers go to
 * POST /api/survey, tied to no store, and can't be changed once sent.
 */
export function OwnerSurveyForm({
  answers,
  isPublic = false,
}: {
  answers: OwnerSurveyAnswers | null;
  isPublic?: boolean;
}) {
  const router = useRouter();
  const [pains, setPains] = useState<string[]>([...(answers?.pains ?? [])]);
  const [topPain, setTopPain] = useState(answers?.topPain ?? "");
  const [weeklyOrders, setWeeklyOrders] = useState(answers?.weeklyOrders ?? "");
  const [willingToPay, setWillingToPay] = useState(answers?.willingToPay ?? "");
  const [comment, setComment] = useState(answers?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // One problem chosen is the one that hurts most, without asking again.
  const effectiveTop = pains.length === 1 ? pains[0] : pains.includes(topPain) ? topPain : "";
  const complete = pains.length > 0 && effectiveTop !== "" && weeklyOrders !== "" && willingToPay !== "";

  function togglePain(key: string, on: boolean) {
    setSaved(false);
    setPains((current) => (on ? [...current, key] : current.filter((p) => p !== key)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    if (!complete) {
      setError("Please answer the first three questions.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(isPublic ? "/api/survey" : "/api/vendor/survey", {
        method: isPublic ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pains, topPain: effectiveTop, weeklyOrders, willingToPay, comment }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? "Too many answers from this connection. Try again in an hour."
            : "Could not save your answers. Try again.",
        );
        return;
      }
      setSaved(true);
      if (!isPublic) router.refresh();
    } catch {
      setError("Could not save your answers. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (isPublic && saved) {
    return (
      <p role="status" className="text-sm text-foreground">
        Thank you. We read every answer.
      </p>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-6">
      <p className="text-sm text-muted-foreground">{isPublic ? PUBLIC_SURVEY_NOTICE : SURVEY_USE_NOTICE}</p>

      <fieldset>
        <legend className={LEGEND}>What is hard about running your store right now?</legend>
        <p className="text-sm text-muted-foreground">Pick all that apply.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {OWNER_PAINS.map((pain) => (
            <label key={pain.key} className={CHOICE}>
              <input
                type="checkbox"
                checked={pains.includes(pain.key)}
                onChange={(e) => togglePain(pain.key, e.target.checked)}
                className="h-4 w-4 shrink-0"
              />
              {pain.label}
            </label>
          ))}
        </div>
      </fieldset>

      {pains.length > 1 ? (
        <RadioChoices
          name="top-pain"
          legend="Which one hurts most?"
          options={pains.map((key) => ({ key, label: painLabel(key) }))}
          value={effectiveTop}
          onChange={(key) => {
            setSaved(false);
            setTopPain(key);
          }}
        />
      ) : null}

      <RadioChoices
        name="weekly-orders"
        legend="About how many orders do you get in a week?"
        options={WEEKLY_ORDER_BANDS}
        value={weeklyOrders}
        onChange={(key) => {
          setSaved(false);
          setWeeklyOrders(key);
        }}
      />

      <RadioChoices
        name="willing-to-pay"
        legend="If AwaazOS fixed the problem that hurts most, what would you pay a month?"
        options={WILLING_TO_PAY_BANDS}
        value={willingToPay}
        onChange={(key) => {
          setSaved(false);
          setWillingToPay(key);
        }}
      />

      <div>
        <Label htmlFor="survey-comment">Anything else we should build? (optional)</Label>
        <textarea
          id="survey-comment"
          value={comment}
          maxLength={SURVEY_COMMENT_MAX}
          rows={3}
          onChange={(e) => {
            setSaved(false);
            setComment(e.target.value);
          }}
          className={cn(
            "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
            "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />
      </div>

      <div className="space-y-2">
        <Button type="submit" disabled={saving} aria-busy={saving}>
          {saving ? "Saving…" : answers ? "Update my answers" : "Send my answers"}
        </Button>
        <div aria-live="polite">
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : saved ? (
            <p role="status" className="text-sm text-muted-foreground">
              Thank you. We read every answer.
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
