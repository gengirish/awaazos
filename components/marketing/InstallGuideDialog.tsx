"use client";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { INSTALL_STEPS, type InstallGuide } from "@/lib/install-app";

/**
 * Written install steps for this device. Loaded on demand by InstallAppButton
 * (next/dynamic): the dialog primitives are ~18 kB the landing page should not
 * pay for until someone taps "Install app".
 */
export default function InstallGuideDialog({
  guide,
  open,
  onOpenChange,
}: {
  guide: InstallGuide;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const content = INSTALL_STEPS[guide];
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Install AwaazOS</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{content.intro}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-awaaz-charcoal">
            {content.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
