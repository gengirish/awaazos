"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Lock, PlayCircle, Search } from "lucide-react";

import { DISCLOSURE_SUMMARY, DisclosureChevron } from "@/components/help/disclosure";
import { HelpVideoButton } from "@/components/help/HelpVideoButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { matchesHelpQuery, type HelpGroupId, type ResolvedHelpTopic } from "@/lib/help-guide";
import type { ResolvedHelpVideo } from "@/lib/help-videos";

/** "More › Settings › Payments" on a phone, "Settings › Payments" from md up (the rail has no More). */
function WherePath({ topic }: { topic: ResolvedHelpTopic }) {
  return (
    <>
      {topic.behindMore ? <span className="md:hidden">More › </span> : null}
      {topic.path.join(" › ")}
    </>
  );
}

function TopicAnswer({ topic, videos }: { topic: ResolvedHelpTopic; videos: ResolvedHelpVideo[] }) {
  return (
    <div className="px-4 pb-3 text-sm">
      <p className="text-muted-foreground">{topic.steps}</p>
      {topic.ownerLocked ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Only the owner can change this.
        </p>
      ) : null}
      <div className="-mx-2 mt-1 flex flex-col items-start">
        <Link
          href={topic.href}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>
            Go to <WherePath topic={topic} />
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
        {videos.map((video, _i, all) => (
          <HelpVideoButton key={video.id} video={video} showTitle={all.length > 1} />
        ))}
      </div>
    </div>
  );
}

/**
 * The searchable part of the Help page: the search box, the row of films, and
 * the "How do I…" groups. Groups and topics are closed <details> until tapped,
 * so the page opens short; a search opens every group and topic that matches.
 * The topics arrive already trimmed to the viewer's role, and topics and group
 * titles already in the store's words (`helpGroupsFor`).
 */
export function HelpTopicList({
  topics,
  groups: groupList,
  videos = {},
  films = [],
}: {
  topics: ResolvedHelpTopic[];
  groups: { id: HelpGroupId; title: string }[];
  /** Films per topic id; empty when none are published. */
  videos?: Record<string, ResolvedHelpVideo[]>;
  /** Every film for this store, for the row at the top; empty when none are published. */
  films?: ResolvedHelpVideo[];
}) {
  const [query, setQuery] = useState("");
  const inputId = useId();

  const groups = useMemo(() => {
    const matching = topics.filter((topic) => matchesHelpQuery(topic, query));
    return groupList
      .map((group) => ({ ...group, topics: matching.filter((topic) => topic.group === group.id) }))
      .filter((group) => group.topics.length > 0);
  }, [topics, groupList, query]);

  const count = groups.reduce((n, group) => n + group.topics.length, 0);
  const searching = query.trim().length > 0;
  // Remount the disclosures when a search starts or ends, so `open` applies afresh
  // (a <details> keeps its own open state once the seller taps it).
  const mode = searching ? "search" : "browse";

  return (
    <div className="space-y-8">
      <div>
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

      {!searching && films.length > 0 ? (
        <section aria-labelledby="help-videos-heading">
          <h2 id="help-videos-heading" className="font-display text-lg font-semibold text-foreground">
            Watch how it works
          </h2>
          <p className="mb-2 text-sm text-muted-foreground">Short videos with sound and captions. <span className="md:hidden">Swipe for more.</span><span className="hidden md:inline">Scroll sideways for more.</span></p>
          {/* Bleeds to the screen edge on phones so the next card peeks in. */}
          <ul className="-mx-4 flex items-start snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 md:mx-0 md:scroll-px-0 md:px-0">
            {films.map((video) => (
              <li key={video.id} className="shrink-0">
                <HelpVideoButton video={video} variant="card" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="help-how-heading">
        <h2 id="help-how-heading" className="mb-2 font-display text-lg font-semibold text-foreground">
          How do I…
        </h2>
        {count === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground">
            Nothing matches “{query.trim()}”. Try one short word, like “receipt”, “price” or “UPI”.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
            {groups.map((group) => (
              <li key={`${mode}-${group.id}`}>
                <details className="group" open={searching || undefined}>
                  <summary className={DISCLOSURE_SUMMARY}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-foreground">{group.title}</span>
                      <span className="block text-sm text-muted-foreground">
                        {group.topics.length === 1 ? "1 question" : `${group.topics.length} questions`}
                      </span>
                    </span>
                    <DisclosureChevron />
                  </summary>
                  <ul className="divide-y divide-border border-t bg-muted/30">
                    {group.topics.map((topic) => {
                      const topicVideos = videos[topic.id] ?? [];
                      return (
                        <li key={topic.id}>
                          <details className="group/topic" open={searching || undefined}>
                            <summary className={`${DISCLOSURE_SUMMARY} min-h-12 pl-6`}>
                              <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                                {topic.title}
                              </span>
                              {topicVideos.length > 0 ? (
                                <PlayCircle className="h-4 w-4 shrink-0 text-primary" role="img" aria-label="Has a video" />
                              ) : null}
                              <ChevronDown
                                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/topic:rotate-180 motion-reduce:transition-none"
                                aria-hidden="true"
                              />
                            </summary>
                            <div className="pl-2">
                              <TopicAnswer topic={topic} videos={topicVideos} />
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
