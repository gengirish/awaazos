"use client";

import { MoreHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";

/** A full-width, 48px row inside the "More actions" sheet (links and buttons alike). */
export const MORE_ACTION_ROW =
  "flex min-h-12 w-full items-center justify-start gap-3 rounded-md border border-input bg-background px-3 text-left text-sm font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

type Props = {
  /** One line under the sheet title. */
  description: string;
  /** The rows. `close` shuts the sheet, for rows that leave the page in place (e.g. a link to a new tab). */
  children: (close: () => void) => ReactNode;
};

/**
 * Phones only (hidden from `md`, where the same actions sit in the header):
 * one "More actions" button that opens a bottom sheet holding every board
 * action except Refresh, so the orders start near the top of the screen.
 *
 * The sheet's content unmounts when it closes. Anything that must survive that
 * (sound choice, a prepared Instagram story image) lives in the board, not here.
 */
export function BoardMoreActions({ description, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button type="button" variant="outline" className="ml-auto min-h-11 shrink-0 md:hidden" aria-label="More actions">
          <MoreHorizontal aria-hidden />
          More
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>More actions</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="flex flex-col gap-2">{children(() => setOpen(false))}</ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
