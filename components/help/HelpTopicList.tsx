"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Lock, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HELP_GROUPS, matchesHelpQuery, type ResolvedHelpTopic } from "@/lib/help-guide";

/** "More › Settings › Payments" on a phone, "Settings › Payments" from md up (the rail has no More). */
function WherePath({ topic }: { topic: ResolvedHelpTopic }) {
  return (
    <span className="mt-1 block text-xs font-medium text-muted-foreground">
      <span className="sr-only">Where: </span>
      {topic.behindMore ? <span className="md:hidden">More › </span> : null}
      {topic.path.join(" › ")}
    </span>
  );
}

/**
 * The "How do I…" list of the Help page, with a search box that filters it in
 * the browser. The topics arrive already trimmed to the viewer's role.
 */
export function HelpTopicList({ topics }: { topics: ResolvedHelpTopic[] }) {
  const [query, setQuery] = useState("");
  const inputId = useId();

  const groups = useMemo(() => {
    const matching = topics.filter((topic) => matchesHelpQuery(topic, query));
    return HELP_GROUPS.map((group) => ({
      ...group,
      topics: matching.filter((topic) => topic.group === group.id),
    })).filter((group) => group.topics.length > 0);
  }, [topics, query]);

  const count = groups.reduce((n, group) => n + group.topics.length, 0);
  const searching = query.trim().length > 0;

  return (
    <div>
      <div className="mb-4">
        <Label htmlFor={inputId}>Search help</Label>
        <div className="relative mt-1.5">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={inputId}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="receipt, UPI, drop…"
            className="pl-9"
          />
        </div>
        <p role="status" aria-live="polite" className="mt-1.5 min-h-5 text-sm text-muted-foreground">
          {searching ? (count === 1 ? "1 answer" : `${count} answers`) : ""}
        </p>
      </div>

      {count === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground">
          Nothing matches “{query.trim()}”. Try one short word, like “receipt”, “price” or “UPI”.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`help-group-${group.id}`}>
              <h3
                id={`help-group-${group.id}`}
                className="mb-2 font-display text-base font-semibold text-foreground"
              >
                {group.title}
              </h3>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
                {group.topics.map((topic) => (
                  <li key={topic.id}>
                    <Link
                      href={topic.href}
                      className="flex min-h-14 items-center gap-3 px-4 py-3 ring-inset transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-foreground">{topic.title}</span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">{topic.steps}</span>
                        <WherePath topic={topic} />
                        {topic.ownerLocked ? (
                          <span className="mt-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            Only the owner can change this.
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
