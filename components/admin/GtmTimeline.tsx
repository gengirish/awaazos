import { TimelineMarkerDelete, TimelineMarkerForm } from "@/components/admin/TimelineMarkerControls";
import { formatYmd } from "@/lib/admin-free-access";
import { formatINR } from "@/lib/currency";
import { MARKER_KIND_LABEL, TIMELINE_DAYS, type Timeline, type TimelineMarker } from "@/lib/gtm-timeline";

/** Viewbox units per day: a 4-unit bar and a 2-unit gap. */
const SLOT = 6;
const BAR = 4;
const PLOT_H = 72;

function shortDate(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

/** Marker numbers per day, so two markers on one day share one label ("3,4"). */
function markersByDay(markers: readonly TimelineMarker[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const m of markers) out.set(m.dayIndex, [...(out.get(m.dayIndex) ?? []), m.n]);
  return out;
}

/**
 * Stacks the number labels so neighbours don't overlap. Widths are estimated in
 * day slots for a ~300 px phone chart (5 px a day, ~7 px a character), so wider
 * screens only get more room. A label takes the first row where it fits, else
 * the row that frees up soonest.
 */
const LABEL_ROWS = 4;
function labelRows(markerDays: Map<number, number[]>): { day: number; text: string; row: number }[] {
  const ends: number[] = Array(LABEL_ROWS).fill(-Infinity);
  return [...markerDays].map(([day, ns]) => {
    const text = ns.join(",");
    const half = (text.length * 1.4 + 1) / 2;
    let row = ends.findIndex((end) => end <= day + 0.5 - half);
    if (row === -1) row = ends.indexOf(Math.min(...ends));
    ends[row] = day + 0.5 + half;
    return { day, text, row };
  });
}

type ChartProps = {
  title: string;
  values: readonly number[];
  max: number;
  maxLabel: string;
  dayTitle: (i: number) => string;
  markerDays: Map<number, number[]>;
  showNumbers: boolean;
  firstYmd: string;
  lastYmd: string;
};

/**
 * One measure, one axis (dataviz: never a dual axis): bars per IST day, a baseline,
 * the peak as the only y label, and dashed lines on marker days. Every day has a
 * full-height hit area with a title, so hovering anywhere over a day names it.
 */
function DayBars({ title, values, max, maxLabel, dayTitle, markerDays, showNumbers, firstYmd, lastYmd }: ChartProps) {
  const width = TIMELINE_DAYS * SLOT;
  return (
    <figure className="space-y-1">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">Peak day: {maxLabel}</span>
      </figcaption>
      <div className="relative">
        {showNumbers && markerDays.size > 0 ? (
          (() => {
            const labels = labelRows(markerDays);
            const rows = Math.max(...labels.map((l) => l.row)) + 1;
            return (
              // Positions come from the data, so they are the one inline style here (as in TopItemsList).
              <div aria-hidden className="relative" style={{ height: rows * 12 }}>
                {labels.map((l) => (
                  <span
                    key={l.day}
                    className="absolute -translate-x-1/2 text-[11px] font-semibold leading-none text-foreground tabular-nums"
                    style={{ left: `${((l.day + 0.5) / TIMELINE_DAYS) * 100}%`, top: l.row * 12 }}
                  >
                    {l.text}
                  </span>
                ))}
              </div>
            );
          })()
        ) : null}
        <svg
          viewBox={`0 0 ${width} ${PLOT_H}`}
          preserveAspectRatio="none"
          className="block h-24 w-full"
          role="img"
          aria-label={`${title}, ${TIMELINE_DAYS} days from ${formatYmd(firstYmd)} to ${formatYmd(lastYmd)}. The table below has every day.`}
        >
          {[...markerDays.keys()].map((day) => (
            <line
              key={day}
              x1={day * SLOT + SLOT / 2}
              x2={day * SLOT + SLOT / 2}
              y1={0}
              y2={PLOT_H}
              className="stroke-muted-foreground"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {values.map((v, i) => {
            const h = max > 0 ? Math.max((v / max) * (PLOT_H - 2), v > 0 ? 2 : 0) : 0;
            return (
              <g key={i}>
                {h > 0 ? (
                  <rect x={i * SLOT + (SLOT - BAR) / 2} y={PLOT_H - h} width={BAR} height={h} rx={1} className="fill-primary" />
                ) : null}
                <rect x={i * SLOT} y={0} width={SLOT} height={PLOT_H} fill="transparent">
                  <title>{dayTitle(i)}</title>
                </rect>
              </g>
            );
          })}
          <line x1={0} x2={width} y1={PLOT_H} y2={PLOT_H} className="stroke-border" vectorEffect="non-scaling-stroke" />
        </svg>
        <div aria-hidden className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{shortDate(firstYmd)}</span>
          <span>{shortDate(lastYmd)}</span>
        </div>
      </div>
    </figure>
  );
}

type Props = { timeline: Timeline; todayYmd: string };

/**
 * 60 IST days of paid bills and sales on /admin/bets, with what happened on them
 * (lib/gtm-timeline.ts). Two small charts on one day axis, numbered markers
 * explained in the list, and a table of every day.
 */
export function GtmTimeline({ timeline, todayYmd }: Props) {
  const { days, markers } = timeline;
  const first = days[0].ymd;
  const last = days[days.length - 1].ymd;
  const markerDays = markersByDay(markers);
  const dayTitle = (i: number) =>
    `${formatYmd(days[i].ymd)}: ${formatINR(days[i].gmvPaise)}, ${days[i].bills} paid ${days[i].bills === 1 ? "bill" : "bills"}`;
  const labelsByDay = new Map<number, string[]>();
  for (const m of markers) labelsByDay.set(m.dayIndex, [...(labelsByDay.get(m.dayIndex) ?? []), `${m.n}. ${m.label}`]);

  return (
    <section aria-labelledby="timeline-heading" className="space-y-3">
      <div>
        <h2 id="timeline-heading" className="font-display text-xl font-semibold text-foreground">
          GTM timeline
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paid bills and sales over the {TIMELINE_DAYS} complete days before today, {formatYmd(first)} to{" "}
          {formatYmd(last)}: {timeline.totalBills.toLocaleString("en-IN")} paid bills,{" "}
          {formatINR(timeline.totalGmvPaise)}. Numbered lines are the markers listed below.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <DayBars
          title="Sales (GMV) per day"
          values={days.map((d) => d.gmvPaise)}
          max={timeline.maxGmvPaise}
          maxLabel={formatINR(timeline.maxGmvPaise)}
          dayTitle={dayTitle}
          markerDays={markerDays}
          showNumbers
          firstYmd={first}
          lastYmd={last}
        />
        <DayBars
          title="Paid bills per day"
          values={days.map((d) => d.bills)}
          max={timeline.maxBills}
          maxLabel={timeline.maxBills.toLocaleString("en-IN")}
          dayTitle={dayTitle}
          markerDays={markerDays}
          showNumbers={false}
          firstYmd={first}
          lastYmd={last}
        />

        <div>
          <h3 className="text-sm font-semibold text-foreground">Markers</h3>
          {markers.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing marked in these days. Demo stores and first paid bills appear here by themselves.
            </p>
          ) : (
            <ol className="mt-2 divide-y text-sm">
              {markers.map((m) => (
                <li key={`${m.kind}-${m.n}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
                  <span className="w-6 shrink-0 font-semibold tabular-nums text-foreground">{m.n}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">
                      <span className="tabular-nums">{formatYmd(m.ymd)}</span> ·{" "}
                      <span className="text-muted-foreground">{MARKER_KIND_LABEL[m.kind]}</span>
                    </p>
                    <p className="break-words text-foreground">{m.label}</p>
                    {m.note ? <p className="text-xs text-muted-foreground">{m.note}</p> : null}
                  </div>
                  {m.id ? <TimelineMarkerDelete id={m.id} label={m.label} /> : null}
                </li>
              ))}
            </ol>
          )}
        </div>

        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
            Show every day as a table
          </summary>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Paid bills and sales per IST day, with markers</caption>
              <thead className="sticky top-0 bg-card">
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 text-left font-medium">
                    Day
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Paid bills
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Sales
                  </th>
                  <th scope="col" className="py-2 pl-2 text-left font-medium">
                    Markers
                  </th>
                </tr>
              </thead>
              <tbody>
                {days.map((d, i) => (
                  <tr key={d.ymd} className="border-t align-top">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal tabular-nums">
                      {formatYmd(d.ymd)}
                    </th>
                    <td className="px-2 py-1.5 text-right tabular-nums">{d.bills}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatINR(d.gmvPaise)}</td>
                    <td className="py-1.5 pl-2 text-xs text-muted-foreground">{labelsByDay.get(i)?.join("; ") ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <details className="rounded-lg border bg-card p-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">Add a marker</summary>
        <div className="pt-3">
          <TimelineMarkerForm defaultDate={todayYmd} />
        </div>
      </details>
    </section>
  );
}
