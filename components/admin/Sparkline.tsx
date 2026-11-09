import { cn } from "@/lib/utils";

const BAR = 6;
const GAP = 2;
const HEIGHT = 28;

/**
 * A row of bars, one per day, as inline SVG: no chart library. A day with
 * nothing shows a 1 px baseline tick, so an idle stretch reads as idle, not
 * missing. `label` is the accessible description; the bars are decorative.
 */
export function Sparkline({ values, label, className }: { values: readonly number[]; label: string; className?: string }) {
  const max = Math.max(1, ...values);
  const width = values.length * (BAR + GAP) - GAP;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width={width}
      height={HEIGHT}
      className={cn("shrink-0 overflow-visible", className)}
    >
      {values.map((v, i) => {
        const h = v === 0 ? 1 : Math.max(3, Math.round((v / max) * HEIGHT));
        return (
          <rect
            key={i}
            x={i * (BAR + GAP)}
            y={HEIGHT - h}
            width={BAR}
            height={h}
            rx={1}
            className={v === 0 ? "fill-muted-foreground/40" : "fill-primary"}
          />
        );
      })}
    </svg>
  );
}
