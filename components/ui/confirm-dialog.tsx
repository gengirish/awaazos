"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

export type ConfirmDialogProps = {
  open: boolean;
  /** Called with `false` on Cancel, Escape, a tap on the overlay, and after Confirm. */
  onOpenChange: (open: boolean) => void;
  /** The question, e.g. "Remove Samosa from the menu?". */
  title: React.ReactNode;
  /** One sentence on what happens next. */
  description: React.ReactNode;
  /** The action in a word or two, e.g. "Remove". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button, and Cancel takes the initial focus. Default `true`. */
  destructive?: boolean;
  /** Runs once, on the confirm button only. The dialog closes itself first. */
  onConfirm: () => void;
};

/**
 * The app's replacement for `window.confirm`: a bottom sheet below `md`, a
 * centred dialog from `md` (see `responsive-dialog.tsx`). Radix supplies the
 * focus trap, Escape and the title/description wiring; focus goes back to the
 * control that opened it.
 *
 * Nothing but the confirm button acts. For a destructive action the initial
 * focus is Cancel, so a stray Enter or Space never deletes anything.
 *
 * The caller owns `open`. Keep whatever the title names (a count, an item) in
 * state until the next open, not cleared on close, so the text does not change
 * during the closing animation.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        hideClose
        className="md:max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (destructive ? cancelRef : confirmRef).current?.focus();
        }}
      >
        <ResponsiveDialogHeader className="pr-4 md:pr-6">
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant={destructive ? "destructive" : "default"}
            className="min-h-11"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
