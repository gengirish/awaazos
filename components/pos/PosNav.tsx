"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { StaffRole } from "@prisma/client";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export type PosNavProps = {
  /** The signed-in staff member's role at this vendor (`StaffMember.role`). */
  staffRole: StaffRole;
};

const LINK =
  "inline-flex min-h-11 min-w-[44px] items-center justify-center rounded-md px-3 text-sm font-medium text-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/**
 * POS top navigation: two primary links and a "More" overflow.
 *
 * Owner/manager pages are hidden from a CASHIER — the server still enforces
 * the role on each page; this only keeps a cashier from tapping into a dead end.
 * `/drops` (the list) and `/analytics` require MANAGER; Menu and Transactions
 * are hidden from cashiers by product choice (they're owner tools).
 */
export function PosNav({ staffRole }: PosNavProps) {
  const isCashier = staffRole === "CASHIER";

  const primary: { href: string; label: string }[] = [{ href: "/orders", label: "Orders" }];
  if (!isCashier) primary.push({ href: "/drops", label: "Drops" });

  const more: { href: string; label: string }[] = isCashier
    ? []
    : [
        { href: "/menu", label: "Menu" },
        { href: "/transactions", label: "Transactions" },
        { href: "/analytics", label: "Analytics" },
      ];

  return (
    <nav className="mb-4 flex items-center gap-1" aria-label="POS navigation">
      {primary.map((l) => (
        <Link key={l.href} href={l.href} className={LINK}>
          {l.label}
        </Link>
      ))}
      {more.length > 0 ? <MoreMenu links={more} /> : null}
    </nav>
  );
}

function MoreMenu({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    // Tabbing out of the panel closes it, so it never lingers behind focus.
    const onFocusIn = (e: FocusEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={cn(LINK, "gap-1")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        More
        <ChevronDown
          className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          id={panelId}
          className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className={cn(LINK, "w-full justify-start")}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
