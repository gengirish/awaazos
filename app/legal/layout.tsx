import type { ReactNode } from "react";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <article className="prose prose-slate max-w-none">{children}</article>
    </main>
  );
}

