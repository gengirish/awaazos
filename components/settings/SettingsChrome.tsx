import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Top of every Settings section page: a "Settings" back link on phones (the
 * sidebar does that job on md+), then the page title.
 */
export function SettingsPageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-4 md:mb-6">
      <Link
        href="/settings"
        className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Settings
      </Link>
      <h1 className="font-display text-2xl font-bold text-foreground">{title}</h1>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </header>
  );
}

/** A titled block on a Settings page. Renders an h2 under the page's h1. */
export function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn("rounded-lg border bg-card p-4 text-card-foreground shadow-sm sm:p-6", className)}
    >
      <h2 id={headingId} className="font-display text-lg font-semibold leading-tight">
        {title}
      </h2>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
