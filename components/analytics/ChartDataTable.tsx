import type { ReactNode } from "react";

/**
 * The "Show data table" disclosure under each chart: the same numbers as the
 * chart, for screen readers and for anyone who wants the exact figures.
 *
 * The padding sits on the <summary> so the whole 44 px row opens it, not just
 * the 20 px of text. The table scrolls inside its own box if it is ever wider
 * than the card, so it can never widen the page.
 */
export function ChartDataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <details className="mt-4 rounded-md border border-border bg-muted/30 text-sm">
      <summary className="cursor-pointer rounded-md p-3 font-medium text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        Show data table
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </details>
  );
}
