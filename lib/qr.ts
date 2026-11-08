import QRCode from "qrcode";

/**
 * QR code as an inline SVG data URL, rendered locally.
 *
 * Replaces the old api.qrserver.com image URL, which sent every UPI link
 * (payee VPA, name and amount) to a third party and didn't work offline.
 * Works in node (server components) and the browser (the POS, offline).
 */
export async function qrSvgDataUrl(text: string, size: number): Promise<string> {
  const svg = await QRCode.toString(text, {
    type: "svg",
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Same QR as a PNG data URL, for saving to the phone's gallery: UPI apps'
 * "scan from gallery" reads photos, not SVGs. A wider quiet zone than the
 * on-screen SVG, because a saved image is often cropped or shown edge to edge.
 */
export async function qrPngDataUrl(text: string, size: number): Promise<string> {
  return QRCode.toDataURL(text, {
    type: "image/png",
    width: size,
    margin: 4,
    errorCorrectionLevel: "M",
  });
}
