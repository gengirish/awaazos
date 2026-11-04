import {
  painLabel,
  weeklyOrdersLabel,
  willingToPayLabel,
  type OwnerSurveyAnswers,
} from "@/lib/owner-survey";

/** One store's survey answers, beside its price on /admin/vendors. */
export function StoreSurveySummary({ answers }: { answers: OwnerSurveyAnswers | null }) {
  if (!answers) {
    return <p className="mt-2 text-xs text-muted-foreground">Owner survey: not answered yet.</p>;
  }
  const others = answers.pains.filter((p) => p !== answers.topPain);
  return (
    <dl className="mt-3 space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
      <div>
        <dt className="inline font-medium">Hurts most: </dt>
        <dd className="inline">{painLabel(answers.topPain)}</dd>
      </div>
      {others.length > 0 ? (
        <div>
          <dt className="inline font-medium">Also: </dt>
          <dd className="inline">{others.map(painLabel).join("; ")}</dd>
        </div>
      ) : null}
      <div>
        <dt className="inline font-medium">Orders a week: </dt>
        <dd className="inline">{weeklyOrdersLabel(answers.weeklyOrders)}</dd>
      </div>
      <div>
        <dt className="inline font-medium">Would pay a month: </dt>
        <dd className="inline">{willingToPayLabel(answers.willingToPay)}</dd>
      </div>
      {answers.comment ? (
        <div>
          <dt className="inline font-medium">Comment: </dt>
          <dd className="inline break-words">{answers.comment}</dd>
        </div>
      ) : null}
    </dl>
  );
}
