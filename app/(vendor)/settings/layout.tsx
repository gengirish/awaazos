import type { ReactNode } from "react";

import { SettingsNav } from "@/components/settings/SettingsNav";

/**
 * Settings section layout, inside the app shell (app/(vendor)/layout.tsx):
 * a section sidebar on md+ beside the page; on phones the hub (/settings) is
 * the list and each section page links back to it.
 *
 * Navigation between app areas, the skip link and Sign out belong to the
 * shell. Auth is enforced by each page (`requireSettingsContext`).
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-5xl gap-8 px-4 pb-10 pt-4 md:px-6 md:pt-6">
      <aside className="hidden w-56 shrink-0 md:block">
        <SettingsNav />
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 max-w-3xl flex-1 focus:outline-hidden">
        {children}
      </main>
    </div>
  );
}
