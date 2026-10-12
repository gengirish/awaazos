import { ChevronRight, Monitor, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HelpTopicList } from "@/components/help/HelpTopicList";
import { SupportEmailLink } from "@/components/legal/SupportEmailLink";
import { APP_NAV_ICONS } from "@/components/shell/nav-icons";
import { appNavItemsForRole } from "@/lib/app-nav";
import { HELP_SCREEN_SUMMARY, helpTopicsForRole } from "@/lib/help-guide";
import { AuthError, requireVendorRole } from "@/lib/rbac";

import { getShellContext } from "../_shell-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Help · AwaazOS" };

/** "A, B and C" */
function listOf(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * Self-help guide to getting around the app: how the navigation works, what
 * each screen is for, and a searchable "How do I…" list. Everything is trimmed
 * to the viewer's role from lib/app-nav.ts, so it never points at a screen the
 * navigation doesn't show them. Static content: no reads beyond the shell's.
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
  const { storePath } = await getShellContext();

  const items = appNavItemsForRole(role);
  const screens = items.filter((item) => item.id !== "help");
  const tabs = items.filter((item) => item.placement === "tab").map((item) => item.label);
  const behindMore = [
    ...items.filter((item) => item.placement === "more").map((item) => item.label),
    ...(storePath ? ["Live store"] : []),
    "Sign out",
  ];
  const railFoot = storePath ? "Live store and Sign out are" : "Sign out is";

  return (
    <div className="bg-background p-4 pb-10 md:p-6">
      <header className="mx-auto mb-4 max-w-3xl md:mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Help</h1>
        <p className="text-sm text-muted-foreground">Where everything is in AwaazOS, and how to get there.</p>
      </header>

      <main id="main" className="mx-auto max-w-3xl space-y-8">
        <section aria-labelledby="help-around-heading">
          <h2 id="help-around-heading" className="mb-2 font-display text-lg font-semibold text-foreground">
            Getting around
          </h2>
          {/* One of the two is on screen, matching the navigation this viewport gets. */}
          <div className="rounded-lg border bg-card p-4 text-sm text-foreground md:hidden">
            <p className="flex items-center gap-2 font-semibold">
              <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />
              On your phone
            </p>
            <p className="mt-1.5 text-muted-foreground">
              The bar at the bottom of the screen opens {listOf(tabs)}. Tap <strong>More</strong> at its right end for{" "}
              {listOf(behindMore)}.
            </p>
            <p className="mt-1.5 text-muted-foreground">
              The tab with the bar above it and bold text is the screen you are on.
            </p>
          </div>
          <div className="hidden rounded-lg border bg-card p-4 text-sm text-foreground md:block">
            <p className="flex items-center gap-2 font-semibold">
              <Monitor className="h-4 w-4 shrink-0" aria-hidden="true" />
              On a tablet or computer
            </p>
            <p className="mt-1.5 text-muted-foreground">
              Every screen is in the strip down the left side. {railFoot} at the bottom of it.
            </p>
            <p className="mt-1.5 text-muted-foreground">The highlighted entry is the screen you are on.</p>
          </div>
        </section>

        <section aria-labelledby="help-screens-heading">
          <h2 id="help-screens-heading" className="mb-2 font-display text-lg font-semibold text-foreground">
            What each screen is for
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
            {screens.map((item) => {
              const Icon = APP_NAV_ICONS[item.id];
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex min-h-14 items-center gap-3 px-4 py-3 ring-inset transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-foreground">{item.label}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {HELP_SCREEN_SUMMARY[item.id]}
                      </span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="help-how-heading">
          <h2 id="help-how-heading" className="mb-2 font-display text-lg font-semibold text-foreground">
            How do I…
          </h2>
          <HelpTopicList topics={helpTopicsForRole(role)} />
        </section>

        <section aria-labelledby="help-contact-heading" className="text-sm text-muted-foreground">
          <h2 id="help-contact-heading" className="mb-1 font-display text-lg font-semibold text-foreground">
            Still stuck?
          </h2>
          <p className="[&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:font-semibold [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4">
            Write to us at <SupportEmailLink /> and tell us which screen you are on.
          </p>
        </section>
      </main>
    </div>
  );
}
