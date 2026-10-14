"use client";

import { QrCode } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** Literal classes so Tailwind can see them; one per size the storefront uses. */
const BOX: Record<180 | 220, string> = {
  180: "h-[180px] w-[180px]",
  220: "h-[220px] w-[220px]",
};

/**
 * Counter UPI QR in a fixed-size box (no layout shift).
 *
 * The image is an inline SVG data URL rendered on the server (lib/qr.ts), so
 * it is visible in the server HTML: no loading placeholder, which would stay
 * up until hydration on a slow phone (or forever without JS). If it fails to
 * decode it says so plainly — the UPI ID and "Open UPI app" next to it still
 * work.
 *
 * `sample` (demo stores) puts a small "SAMPLE" badge in the centre. It covers
 * about 3% of the code, well inside what level-M error correction (≈15%,
 * lib/qr.ts) recovers, so the QR still scans. Don't make it a full-width band.
 */
export function UpiQrImage({
  src,
  alt,
  size,
  sample = false,
}: {
  src: string;
  alt: string;
  size: 180 | 220;
  sample?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={cn("relative overflow-hidden rounded-lg", BOX[size])}>
      {failed ? (
        <div
          role="status"
          className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-muted px-3 text-center text-xs font-semibold text-muted-foreground"
        >
          <QrCode className="h-8 w-8" aria-hidden="true" />
          QR didn&apos;t load. Use the UPI ID below.
        </div>
      ) : (
        <>
          <Image
            src={src}
            alt={sample ? `${alt} (sample)` : alt}
            width={size}
            height={size}
            unoptimized
            onError={() => setFailed(true)}
            className="rounded-lg"
          />
          {sample ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-background px-1.5 text-[11px] font-bold uppercase leading-4 tracking-wider text-destructive ring-1 ring-destructive"
            >
              Sample
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
