import type { ReactNode } from "react";

/**
 * Settings section layout, inside the app shell (app/(vendor)/layout.tsx): one
 * column on every screen. The hub (/settings) is the list and each section page
 * links back to it.
 *
 * Navigation between app areas, the skip link and Sign out belong to the
 * shell. Auth is enforced by each page (`requireSettingsContext`).
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 pb-10 pt-4 focus:outline-hidden md:px-6 md:pt-6">
      {children}
    </main>
  );
}
