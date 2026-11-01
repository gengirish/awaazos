"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";

import { isAppleMobile } from "@/lib/upi";
import { cn } from "@/lib/utils";

/**
 * "Save QR to gallery" for a buyer paying from the phone that shows the page.
 *
 * Some UPI apps refuse a payment opened from a link to a personal UPI ID
 * ("This payment may fail as per UPI Risk Policy") and tell the buyer to scan a
 * QR instead. A QR on the same screen can't be scanned, but every big UPI app
 * can scan one from the gallery.
 *
 * - iPhone/iPad: the share sheet (its "Save Image" puts it in Photos); a
 *   `download` link only opens the image there.
 * - Elsewhere: a `download` link, which Android Chrome saves to Downloads,
 *   where the gallery picker finds it.
 *
 * The PNG arrives as a data URL; it is decoded here rather than `fetch`ed,
 * because the CSP's `connect-src` does not allow `data:`.
 */
export type SaveQrButtonProps = {
  /** From `qrPngDataUrl`. */
  pngDataUrl: string;
  /** Without extension, e.g. `upi-AWZ-20261101-0001`. */
  fileName: string;
  className?: string;
};

function pngFile(dataUrl: string, name: string): File {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: "image/png" });
}

export function SaveQrButton({ pngDataUrl, fileName, className }: SaveQrButtonProps) {
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setIos(isAppleMobile(navigator.userAgent, navigator.platform ?? "", navigator.maxTouchPoints ?? 0));
  }, []);

  const name = `${fileName}.png`;

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!ios || typeof navigator.share !== "function") return; // let the download link run
    const file = pngFile(pngDataUrl, name);
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return;
    e.preventDefault();
    try {
      await navigator.share({ files: [file] });
    } catch {
      // Closing the share sheet rejects too; nothing to report.
    }
  }

  return (
    <a
      href={pngDataUrl}
      download={name}
      onClick={(e) => void onClick(e)}
      className={cn(
        "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-background px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 motion-reduce:transition-none",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        className,
      )}
    >
      <Download className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      Save QR to gallery
    </a>
  );
}
