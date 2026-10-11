"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

/**
 * Below `sm` the five tabs share one row as equal grid columns (about 60 px
 * each at 360 px), so "Custom" never wraps onto a line of its own. The active
 * tab is filled and bold, not just a different colour.
 */
function tabClass(isActive: boolean): string {
  return cn(
    "inline-flex min-h-11 items-center justify-center rounded-full px-1 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4",
    isActive
      ? "bg-primary font-semibold text-primary-foreground"
      : "bg-muted font-medium text-muted-foreground hover:bg-muted/80",
  );
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
    <nav aria-label="Date range" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="grid grid-cols-5 gap-1.5 sm:flex sm:flex-wrap sm:gap-2" role="tablist" aria-label="Preset ranges">
        {PRESETS.map((p) => {
          const isActive = active === p.value;
          return (
            <Link
              key={p.value}
              href={buildPresetHref(p.value)}
              role="tab"
              aria-selected={isActive}
              scroll={false}
              className={tabClass(isActive)}
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
          className={tabClass(active === "custom")}
        >
          Custom
        </Link>
      </div>
      {/* Phones: From and To share a row at full width, Apply spans beneath them. */}
      <div className="grid grid-cols-2 items-end gap-2 border-t border-border pt-3 sm:flex sm:flex-wrap sm:border-0 sm:pt-0">
        <div className="min-w-0">
          <label htmlFor="analytics-from" className="mb-1 block text-xs font-medium text-muted-foreground">
            From
          </label>
          <Input
            id="analytics-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-11 min-w-0 sm:w-auto"
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="analytics-to" className="mb-1 block text-xs font-medium text-muted-foreground">
            To
          </label>
          <Input
            id="analytics-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-11 min-w-0 sm:w-auto"
          />
        </div>
        <Button type="button" onClick={applyCustom} className="col-span-2 h-11 rounded-full sm:col-span-1">
          Apply
        </Button>
      </div>
    </nav>
  );
}
