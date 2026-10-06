"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SETTINGS_OVERVIEW, SETTINGS_SECTIONS } from "@/components/settings/sections";
import { cn } from "@/lib/utils";

/**
 * md+ sidebar. The current page is marked with aria-current, bold text and a
 * bar on the left edge — never by colour alone.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const items = [SETTINGS_OVERVIEW, ...SETTINGS_SECTIONS];

  return (
    <nav aria-label="Settings" className="sticky top-4">
      <ul className="space-y-1">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  active
                    ? "bg-muted font-semibold text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
