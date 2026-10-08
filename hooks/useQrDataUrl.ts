"use client";

import { useEffect, useState } from "react";

import { qrSvgDataUrl } from "@/lib/qr";

/** Client-side QR for `text`; "" while rendering or when `text` is empty. */
export function useQrDataUrl(text: string, size: number): string {
  const [src, setSrc] = useState("");

  useEffect(() => {
    if (!text) {
      setSrc("");
      return;
    }
    let cancelled = false;
    qrSvgDataUrl(text, size)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [text, size]);

  return src;
}
