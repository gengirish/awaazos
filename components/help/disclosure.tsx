import { ChevronDown } from "lucide-react";

/**
 * The Help page's collapsible rows: a native <details> whose summary drops the
 * browser's marker for a chevron that turns when open. Not a client module, so
 * the server page and the client topic list share it.
 */
export const DISCLOSURE_SUMMARY =
  "flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 ring-inset transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none [&::-webkit-details-marker]:hidden";

/** Put on a <details className="group">; turns when that details is open. */
export function DisclosureChevron() {
  return (
    <ChevronDown
      className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
      aria-hidden="true"
    />
  );
}
