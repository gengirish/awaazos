/**
 * The founders' WhatsApp for the landing page's "Chat with us" button and the
 * marketing footer (pure, client-safe). Set NEXT_PUBLIC_SUPPORT_WHATSAPP to an
 * Indian mobile ("98765 43210" or "+919876543210"); unset or not a mobile → no
 * button anywhere. It is read at build time, so changing it needs a deploy.
 */
import { normaliseIndianMobile } from "@/lib/phone";

const PREFILL = "Hi! I'd like to know more about AwaazOS for my store.";

/** wa.me link with a prefilled first message, or null when no usable number is set. */
export function supportWhatsappUrl(raw: string | undefined = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP): string | null {
  if (!raw?.trim()) return null;
  const e164 = normaliseIndianMobile(raw);
  if (!/^\+91[6-9]\d{9}$/.test(e164)) return null;
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(PREFILL)}`;
}
