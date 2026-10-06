"use client";

import { QrCode } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Literal classes so Tailwind can see them; one per size the storefront uses. */
const BOX: Record<180 | 220, string> = {
  180: "h-[180px] w-[180px]",
  220: "h-[220px] w-[220px]",
};

/**
 * Counter UPI QR with a fixed-size box and a visible loading state.
 *
 * The image comes from an external QR renderer and can take a second or more
 * on a mela-ground connection; without a placeholder the box just looks empty.
 * The box is sized up front (no layout shift), shows "Loading QR…" until the
 * image fires `load`, and says so plainly if it fails — the UPI ID and "Open
 * UPI app" next to it still work.
 */
export function UpiQrImage({ src, alt, size }: { src: string; alt: string; size: 180 | 220 }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const imgRef = useRef<HTMLImageElement>(null);

  // A cached image can finish before hydration attaches onLoad.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setState("loaded");
  }, []);

  return (
    <div
      className={cn("relative overflow-hidden rounded-lg", BOX[size])}
      aria-busy={state === "loading"}
    >
      <Image
        ref={imgRef}
        src={src}
        alt={alt}
        width={size}
        height={size}
        unoptimized
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
        className={cn(
          "rounded-lg transition-opacity duration-150 motion-reduce:transition-none",
          state === "loaded" ? "opacity-100" : "opacity-0",
        )}
      />
      {state !== "loaded" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-xs font-semibold text-muted-foreground">
          {/* Only the backdrop pulses, so the label stays readable. */}
          <div
            aria-hidden="true"
            className={cn(
              "absolute inset-0 rounded-lg bg-muted",
              state === "loading" && "animate-pulse motion-reduce:animate-none",
            )}
          />
          <QrCode className="relative h-8 w-8" aria-hidden="true" />
          <span role="status" className="relative">
            {state === "loading" ? "Loading QR…" : "QR didn't load. Use the UPI ID below."}
          </span>
        </div>
      ) : null}
    </div>
  );
}
