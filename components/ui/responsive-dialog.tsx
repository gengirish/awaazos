"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A modal that is a bottom sheet below `md` and a centred dialog from `md` up.
 *
 * The switch is CSS only: one Radix Dialog, one Content element, two sets of
 * breakpoint classes. Nothing is chosen in JavaScript, so there is no
 * media-query state to hydrate, and rotating the phone or resizing across
 * 768px while it is open restyles the same DOM node instead of remounting it
 * (a remount would drop form state, focus and scroll position).
 *
 * Everything Radix Dialog gives stays as is: `role="dialog"`, focus trap,
 * Escape, the title/description wiring and `onOpenAutoFocus`.
 *
 * Layout: Header and Footer stay put, Body scrolls.
 *
 *   <ResponsiveDialog open={open} onOpenChange={setOpen}>
 *     <ResponsiveDialogContent>
 *       <ResponsiveDialogHeader>
 *         <ResponsiveDialogTitle>…</ResponsiveDialogTitle>
 *         <ResponsiveDialogDescription>…</ResponsiveDialogDescription>
 *       </ResponsiveDialogHeader>
 *       <ResponsiveDialogBody>…</ResponsiveDialogBody>
 *       <ResponsiveDialogFooter>…</ResponsiveDialogFooter>
 *     </ResponsiveDialogContent>
 *   </ResponsiveDialog>
 */
const ResponsiveDialog = DialogPrimitive.Root;

const ResponsiveDialogTrigger = DialogPrimitive.Trigger;

const ResponsiveDialogClose = DialogPrimitive.Close;

const SHEET =
  // Inside the left/right safe areas by position (landscape notch); the home
  // indicator is cleared with padding so the sheet's own background covers it.
  "fixed bottom-0 left-[env(safe-area-inset-left)] right-[env(safe-area-inset-right)] z-50 flex max-h-[92dvh] flex-col rounded-t-xl border-t bg-background pb-[env(safe-area-inset-bottom)] shadow-lg focus:outline-hidden";

const CENTRED =
  "md:bottom-auto md:left-1/2 md:right-auto md:top-1/2 md:max-h-[90dvh] md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:pb-0";

const MOTION =
  // Phone: slide up. Desktop: fade + zoom. Reduced motion: a short fade on both.
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-300 data-[state=closed]:duration-200 max-md:motion-safe:data-[state=open]:slide-in-from-bottom max-md:motion-safe:data-[state=closed]:slide-out-to-bottom md:data-[state=open]:duration-200 md:data-[state=open]:fade-in-0 md:data-[state=closed]:fade-out-0 md:motion-safe:data-[state=open]:zoom-in-95 md:motion-safe:data-[state=closed]:zoom-out-95 motion-reduce:data-[state=open]:duration-150 motion-reduce:data-[state=closed]:duration-150 motion-reduce:data-[state=open]:fade-in-0 motion-reduce:data-[state=closed]:fade-out-0";

type ResponsiveDialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /** Hide the corner close button, e.g. when the footer already has a Cancel. Escape still closes. */
  hideClose?: boolean;
};

const ResponsiveDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ResponsiveDialogContentProps
>(({ className, children, hideClose = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content ref={ref} className={cn(SHEET, CENTRED, MOTION, className)} {...props}>
      {children}
      {hideClose ? null : (
        <DialogPrimitive.Close className="absolute right-0.5 top-0.5 flex size-11 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-ring disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
ResponsiveDialogContent.displayName = "ResponsiveDialogContent";

/** Title + description. Right padding keeps a long title out from under the close button. */
const ResponsiveDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex shrink-0 flex-col space-y-1.5 px-4 pb-3 pr-12 pt-5 text-left md:px-6 md:pr-12 md:pt-6", className)}
    {...props}
  />
);
ResponsiveDialogHeader.displayName = "ResponsiveDialogHeader";

/** The scrolling part. `pt-1` leaves room for a focus ring on the first field. */
const ResponsiveDialogBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-1 md:px-6 md:pb-6", className)}
      {...props}
    />
  ),
);
ResponsiveDialogBody.displayName = "ResponsiveDialogBody";

/** Actions, pinned under the body. Stacked full-width on phones (primary on top), a right-aligned row from `md`. */
const ResponsiveDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex shrink-0 flex-col-reverse gap-2 border-t bg-background px-4 py-3 md:flex-row md:justify-end md:rounded-b-lg md:border-t-0 md:px-6 md:pb-6 md:pt-0",
      className,
    )}
    {...props}
  />
);
ResponsiveDialogFooter.displayName = "ResponsiveDialogFooter";

const ResponsiveDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-tight tracking-tight", className)} {...props} />
));
ResponsiveDialogTitle.displayName = "ResponsiveDialogTitle";

const ResponsiveDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
ResponsiveDialogDescription.displayName = "ResponsiveDialogDescription";

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
};
