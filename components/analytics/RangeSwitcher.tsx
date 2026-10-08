"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { AnalyticsRange } from "./types";

const PRESETS: { value: Exclude<AnalyticsRange, "custom">; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

function buildPresetHref(range: Exclude<AnalyticsRange, "custom">): string {
  return `/analytics?range=${range}`;
}

export type RangeSwitcherProps = {
  active: AnalyticsRange;
  customFrom?: string;
  customTo?: string;
  /** YYYY-MM-DD defaults when opening Custom (IST). */
  suggestedCustomFrom: string;
  suggestedCustomTo: string;
};

export function RangeSwitcher({
  active,
  customFrom = "",
  customTo = "",
  suggestedCustomFrom,
  suggestedCustomTo,
}: RangeSwitcherProps) {
  const router = useRouter();
  const [from, setFrom] = useState(customFrom || suggestedCustomFrom);
  const [to, setTo] = useState(customTo || suggestedCustomTo);

  useEffect(() => {
    setFrom(customFrom || suggestedCustomFrom);
    setTo(customTo || suggestedCustomTo);
  }, [customFrom, customTo, suggestedCustomFrom, suggestedCustomTo]);

  const applyCustom = useCallback(() => {
    if (!from || !to) return;
    const sp = new URLSearchParams();
    sp.set("range", "custom");
    sp.set("from", from);
    sp.set("to", to);
    router.push(`/analytics?${sp.toString()}`);
  }, [from, to, router]);

  const customHref = `/analytics?range=custom&from=${encodeURIComponent(suggestedCustomFrom)}&to=${encodeURIComponent(suggestedCustomTo)}`;

  return (
    <nav aria-label="Date range" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Preset ranges">
        {PRESETS.map((p) => {
          const isActive = active === p.value;
          return (
            <Link
              key={p.value}
              href={buildPresetHref(p.value)}
              role="tab"
              aria-selected={isActive}
              scroll={false}
              className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
                isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
        <Link
          href={customHref}
          role="tab"
          aria-selected={active === "custom"}
          scroll={false}
          className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
            active === "custom" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          Custom
        </Link>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3 sm:border-0 sm:pt-0">
        <div>
          <label htmlFor="analytics-from" className="mb-1 block text-xs font-medium text-muted-foreground">
            From
          </label>
          <input
            id="analytics-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="analytics-to" className="mb-1 block text-xs font-medium text-muted-foreground">
            To
          </label>
          <input
            id="analytics-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={applyCustom}
          className="min-h-11 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          Apply
        </button>
      </div>
    </nav>
  );
}
