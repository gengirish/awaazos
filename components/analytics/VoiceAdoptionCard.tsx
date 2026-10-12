"use client";

import { ChartDataTable } from "./ChartDataTable";
import { VoiceDonutPlot } from "./lazy-plots";

export type VoiceAdoptionCardProps = {
  voiceCount: number;
  totalCount: number;
  percent: number;
};

export function VoiceAdoptionCard({ voiceCount, totalCount, percent }: VoiceAdoptionCardProps) {
  const other = Math.max(0, totalCount - voiceCount);

  return (
    <section
      className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-xs"
      aria-labelledby="voice-adoption-heading"
    >
      <h2 id="voice-adoption-heading" className="font-display text-lg font-semibold text-foreground">
        Voice adoption
      </h2>
      {totalCount === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No orders in this range.</p>
      ) : (
        <>
          {/* Donut beside the figure at every width: stacked, it cost a phone 160 px for one number. */}
          <div className="mt-3 flex items-center gap-4">
            <div
              className="h-28 w-28 shrink-0 sm:h-40 sm:w-40"
              role="img"
              aria-label={`Donut chart: ${percent}% voice orders`}
            >
              <VoiceDonutPlot voiceCount={voiceCount} otherCount={other} />
            </div>
            <p className="min-w-0 text-sm text-foreground">
              <span className="font-semibold tabular-nums">{percent}%</span> of orders from voice
              <span className="text-muted-foreground">
                {" "}
                ({voiceCount} voice / {totalCount} total)
              </span>
            </p>
          </div>
          <ChartDataTable caption="Order counts by source for voice adoption">
            <thead>
              <tr>
                <th className="pb-2 pr-4 font-medium">Source</th>
                <th className="pb-2 pr-4 font-medium">Orders</th>
                <th className="pb-2 font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="py-2 pr-4">Voice</td>
                <td className="py-2 pr-4 tabular-nums">{voiceCount}</td>
                <td className="py-2 tabular-nums">{`${percent}%`}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 pr-4">Other</td>
                <td className="py-2 pr-4 tabular-nums">{other}</td>
                <td className="py-2 tabular-nums">{`${Math.round((other / totalCount) * 100)}%`}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 pr-4 font-medium">Total</td>
                <td className="py-2 pr-4 tabular-nums">{totalCount}</td>
                <td className="py-2 tabular-nums">100%</td>
              </tr>
            </tbody>
          </ChartDataTable>
        </>
      )}
    </section>
  );
}
