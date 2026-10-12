import type { ReactNode } from "react";

// No typography plugin in this app, so the pages' plain h1/h2/p/ul/code are
// styled from here. Inline links get vertical padding (it grows the tap area of
// an inline element without moving the line).
const legalProseClass = [
  "text-base leading-7 text-awaaz-charcoal/90",
  "[&_h1]:font-display [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:tracking-tight [&_h1]:text-awaaz-charcoal sm:[&_h1]:text-4xl",
  "[&_h1+p]:mt-2 [&_h1+p]:text-sm [&_h1+p]:text-muted-foreground",
  "[&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-snug [&_h2]:text-awaaz-charcoal",
  "[&_p]:mt-4",
  "[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm",
  "[&_a]:py-3 [&_a]:font-medium [&_a]:text-awaaz-charcoal [&_a]:underline [&_a]:underline-offset-4 [&_a]:outline-hidden [&_a]:break-words [&_a]:hover:text-awaaz-orange [&_a]:focus-visible:ring-2 [&_a]:focus-visible:ring-awaaz-orange",
].join(" ");

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <article className={legalProseClass}>{children}</article>
    </div>
  );
}
