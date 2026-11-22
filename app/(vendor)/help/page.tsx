import { ChevronRight, Monitor, PlayCircle, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DISCLOSURE_SUMMARY, DisclosureChevron } from "@/components/help/disclosure";
import { HelpTopicList } from "@/components/help/HelpTopicList";
import { HelpVideoButton } from "@/components/help/HelpVideoButton";
import { SupportContactList } from "@/components/help/SupportContactList";
import { appNavIcon } from "@/components/shell/nav-icons";
import { appNavItemsForRole, appTabBarForRole } from "@/lib/app-nav";
import { BRAND_NAME } from "@/lib/brand";
import {
  helpGroupsFor,
  helpScreenSummary,
  helpTopicsForRole,
  orderJourneyFor,
  type OrderJourneyStep,
} from "@/lib/help-guide";
import { helpVideosFor } from "@/lib/help-videos";
import { env } from "@/lib/env";
import { AuthError, requireVendorRole } from "@/lib/rbac";

import { getShellContext } from "../_shell-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: `Help · ${BRAND_NAME}` };

/** "A, B and C" */
function listOf(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** "Confirm" for the seller's own steps, "Rider delivers and taps Delivered" for the others. */
function journeyHeading(step: OrderJourneyStep): string {
  if (step.who === "You") return step.title;
  return `${step.who} ${step.title.charAt(0).toLowerCase()}${step.title.slice(1)}`;
}

/**
 * Self-help guide: search and the "How do I…" groups, a row of short films, the
 * order journey, and how the navigation works. It opens short: groups, topics,
 * journey steps and "Getting around" are closed <details> until tapped, and a
 * search opens what matches. Everything is trimmed to the viewer's role from
 * lib/app-nav.ts, so it never points at a screen the navigation doesn't show
 * them. Static content: no reads beyond the shell's. Films (lib/help-videos.ts)
 * appear once HELP_VIDEO_BASE_URL names the folder they were published to; it is
 * read on each render, so no rebuild.
 */
export default async function HelpPage() {
  let ctx: Awaited<ReturnType<typeof requireVendorRole>>;
  try {
    ctx = await requireVendorRole("CASHIER");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }
  const role = ctx.staff.role;
  const { storePath, storeKind } = await getShellContext();

  const items = appNavItemsForRole(role, storeKind);
  const screens = items.filter((item) => item.id !== "help");
  const bar = appTabBarForRole(role, storePath !== null, storeKind);
  const tabs = bar.tabs.map((item) => item.label);
  const behindMore = [...bar.more.map((item) => item.label), "Sign out"];
  const videos = helpVideosFor(storeKind, env.HELP_VIDEO_BASE_URL);

  return (
    <div className="bg-background p-4 pb-10 md:p-6">
      <header className="mx-auto mb-4 max-w-3xl md:mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Help</h1>
        <p className="text-sm text-muted-foreground">
          {videos.list.length > 0
            ? "Search for a question, or watch a short video."
            : "Search for a question, or tap a topic."}
        </p>
      </header>

      <main id="main" className="mx-auto max-w-3xl space-y-8">
        <HelpTopicList
          topics={helpTopicsForRole(role, storePath !== null, storeKind)}
          groups={helpGroupsFor(storeKind)}
          videos={videos.topics}
          films={videos.list}
        />

        <section aria-labelledby="help-journey-heading">
          <h2 id="help-journey-heading" className="font-display text-lg font-semibold text-foreground">
            An online order, start to finish
          </h2>
          <p className="mb-2 text-sm text-muted-foreground">
            Who taps what, from your store page to Done. Pickups skip the rider. Tap a step for more.
          </p>
          <ol className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
            {orderJourneyFor(storeKind).map((step, i) => {
              const stepVideos = videos.journey[step.id] ?? [];
              return (
                <li key={step.id}>
                  <details className="group">
                    <summary className={`${DISCLOSURE_SUMMARY} min-h-12`}>
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-sm font-bold text-primary"
                        aria-hidden="true"
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                        <span className="sr-only">Step {i + 1}: </span>
                        {journeyHeading(step)}
                        {step.when ? (
                          <span className="ml-2 rounded border border-border px-1.5 py-0.5 align-middle text-xs font-medium text-muted-foreground">
                            {step.when}
                          </span>
                        ) : null}
                      </span>
                      {stepVideos.length > 0 ? (
                        <PlayCircle className="h-4 w-4 shrink-0 text-primary" role="img" aria-label="Has a video" />
                      ) : null}
                      <DisclosureChevron />
                    </summary>
                    <div className="pb-3 pl-14 pr-4 text-sm">
                      <p className="text-muted-foreground">{step.text}</p>
                      {stepVideos.map((video) => (
                        <div key={video.id} className="-mx-2">
                          <HelpVideoButton video={video} />
                        </div>
                      ))}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        </section>

        <section aria-labelledby="help-around-heading">
          <h2 id="help-around-heading" className="mb-2 font-display text-lg font-semibold text-foreground">
            Getting around
          </h2>
          <details className="group overflow-hidden rounded-lg border bg-card">
            <summary className={DISCLOSURE_SUMMARY}>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">Where each screen is</span>
                <span className="block text-sm text-muted-foreground">The tab bar, the More menu, and what each screen is for</span>
              </span>
              <DisclosureChevron />
            </summary>
            <div className="border-t px-4 py-3 text-sm">
              {/* One of the two is on screen, matching the navigation this viewport gets. */}
              <div className="md:hidden">
                <p className="flex items-center gap-2 font-semibold text-foreground">
                  <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />
                  On your phone
                </p>
                <p className="mt-1.5 text-muted-foreground">
                  The bar at the bottom of the screen opens {listOf(tabs)}. Tap <strong>More</strong> at its right end
                  for {listOf(behindMore)}. The tab with the bar above it and bold text is the screen you are on.
                </p>
              </div>
              <div className="hidden md:block">
                <p className="flex items-center gap-2 font-semibold text-foreground">
                  <Monitor className="h-4 w-4 shrink-0" aria-hidden="true" />
                  On a tablet or computer
                </p>
                <p className="mt-1.5 text-muted-foreground">
                  Every screen is in the strip down the left side, with Sign out at the bottom. The highlighted entry
                  is the screen you are on.
                </p>
              </div>
            </div>
            <ul className="divide-y divide-border border-t" aria-label="What each screen is for">
              {screens.map((item) => {
                const Icon = appNavIcon(item.id);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="flex min-h-14 items-center gap-3 px-4 py-3 ring-inset transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-foreground">{item.label}</span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">
                          {helpScreenSummary(item.id, storeKind)}
                        </span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </details>
        </section>

        <section aria-labelledby="help-contact-heading" className="text-sm text-muted-foreground">
          <h2 id="help-contact-heading" className="mb-1 font-display text-lg font-semibold text-foreground">
            Still stuck?
          </h2>
          <p className="mb-3">Tell us which screen you are on and what you were trying to do.</p>
          <SupportContactList headingId="help-contact-heading" />
        </section>
      </main>
    </div>
  );
}
