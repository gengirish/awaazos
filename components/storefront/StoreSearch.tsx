"use client";

import { Search, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { matchesSearch, searchTerms } from "@/lib/store-search";

/**
 * Item search on the public store page. Everything the page shows is already
 * in the HTML, so this only hides what doesn't match (lib/store-search.ts):
 * no request, no timer. Carts are untouched — a hidden row keeps its quantity.
 *
 * Pieces:
 *   - StoreSearchProvider wraps the sticky bar and the menu; `index` is the
 *     text of every searchable item, for the result count and "no matches".
 *   - StoreSearchBar sits in the sticky bar: a search button beside the
 *     category pills that swaps them for a search field (same height, so the
 *     bar never grows and anchor offsets stay right).
 *   - Searchable / HideWhileSearching wrap server-rendered rows and sections;
 *     client lists (MenuOrder, DropOrder) call useStoreSearchMatch().
 */

type StoreSearchState = {
  open: boolean;
  query: string;
  terms: string[];
  index: readonly string[];
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
};

const StoreSearchContext = createContext<StoreSearchState | null>(null);

export function StoreSearchProvider({ index, children }: { index: readonly string[]; children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const terms = useMemo(() => searchTerms(query), [query]);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) setQuery("");
  }, []);
  const value = useMemo(() => ({ open, query, terms, index, setOpen, setQuery }), [open, query, terms, index, setOpen]);
  return <StoreSearchContext.Provider value={value}>{children}</StoreSearchContext.Provider>;
}

/**
 * `(text) => boolean` for the current query; matches everything when no search
 * is active or outside a provider (the components are reused elsewhere).
 */
export function useStoreSearchMatch(): (text: string) => boolean {
  const terms = useContext(StoreSearchContext)?.terms;
  return useCallback((text: string) => matchesSearch(text, terms ?? []), [terms]);
}

function useSearching(): boolean {
  return (useContext(StoreSearchContext)?.terms.length ?? 0) > 0;
}

/**
 * Renders `children` only when one of `texts` matches the search (always, with
 * none). A section passes one text per item, so it shows exactly when one of
 * its rows does.
 */
export function Searchable({ texts, children }: { texts: readonly string[]; children: ReactNode }) {
  const matches = useStoreSearchMatch();
  return texts.some(matches) ? <>{children}</> : null;
}

/** Hidden while a search is active (e.g. "Most loved", which repeats rows). */
export function HideWhileSearching({ children }: { children: ReactNode }) {
  return useSearching() ? null : <>{children}</>;
}

/** "No items match" when a search hides everything. */
export function StoreSearchEmpty() {
  const ctx = useContext(StoreSearchContext);
  if (!ctx || ctx.terms.length === 0) return null;
  if (ctx.index.some((text) => matchesSearch(text, ctx.terms))) return null;
  return (
    <EmptyState
      role="status"
      className="rounded-2xl bg-background px-4 py-12"
      title={`No items match “${ctx.query.trim()}”`}
      description="Try another word, or clear the search to see everything."
      action={
        <button
          type="button"
          onClick={() => ctx.setOpen(false)}
          className="inline-flex min-h-11 items-center rounded-full border border-border/70 px-4 text-sm font-semibold text-foreground hover:border-primary/50 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Clear search
        </button>
      }
    />
  );
}

const ICON_BUTTON =
  "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

/**
 * The sticky bar's row: a search button, then `children` (the Top link and
 * category pills). Open, the row is the search field and a close button.
 */
export function StoreSearchBar({ children }: { children: ReactNode }) {
  const ctx = useContext(StoreSearchContext);
  const rowRef = useRef<HTMLDivElement>(null);
  if (!ctx) return <>{children}</>;
  const { open, query, terms, index, setOpen, setQuery } = ctx;
  const count = terms.length > 0 ? index.filter((text) => matchesSearch(text, terms)).length : null;

  function openSearch() {
    setOpen(true);
    // Bring the bar to the top (it is sticky) so the results show under it.
    const top = rowRef.current?.closest("nav")?.getBoundingClientRect().top ?? 0;
    if (top > 0) window.scrollBy({ top });
  }

  return (
    <div ref={rowRef} className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2 sm:px-6">
      {open ? (
        <>
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the buyer's own tap on "Search items"
              autoFocus
              enterKeyHint="search"
              autoComplete="off"
              aria-label="Search items"
              placeholder="Search items"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
              className="min-h-11 w-full rounded-full border border-input bg-background pl-9 pr-4 text-base placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          <button type="button" aria-label="Close search" onClick={() => setOpen(false)} className={ICON_BUTTON}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <button type="button" aria-label="Search items" onClick={openSearch} className={ICON_BUTTON}>
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">{children}</div>
        </>
      )}
      <p aria-live="polite" className="sr-only">
        {count === null ? "" : count === 1 ? "1 item matches" : `${count} items match`}
      </p>
    </div>
  );
}
