/**
 * The one list of ways a seller can reach support from inside the app (Help and
 * Settings). Built from lib/business-contact.ts and the optional support
 * WhatsApp (lib/support-whatsapp.ts), so a number or address changes in one
 * place. Pure and client-safe.
 */
import { BRAND_NAME } from "@/lib/brand";
import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_E164 } from "@/lib/business-contact";
import { normaliseIndianMobile } from "@/lib/phone";

export type SupportContact = {
  id: "whatsapp" | "email" | "phone" | "form";
  label: string;
  detail: string;
  href: string;
  /** Opens outside the app (wa.me). */
  external: boolean;
};

const SELLER_PREFILL = `Hi! I need help with my ${BRAND_NAME} store.`;

/** wa.me link for a seller asking for help, or null when no usable support number is set. */
export function sellerSupportWhatsappUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const e164 = normaliseIndianMobile(raw);
  if (!/^\+91[6-9]\d{9}$/.test(e164)) return null;
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(SELLER_PREFILL)}`;
}

/** WhatsApp (only when configured), email, phone and the contact form, in that order. */
export function supportContacts(whatsappRaw: string | undefined): SupportContact[] {
  const list: SupportContact[] = [];
  const wa = sellerSupportWhatsappUrl(whatsappRaw);
  if (wa) list.push({ id: "whatsapp", label: "Chat on WhatsApp", detail: "Fastest way to reach us", href: wa, external: true });
  list.push(
    { id: "email", label: "Email support", detail: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}`, external: true },
    { id: "phone", label: "Call us", detail: SUPPORT_PHONE_DISPLAY, href: `tel:${SUPPORT_PHONE_E164}`, external: true },
    { id: "form", label: "Send a message", detail: "Use the contact form", href: "/contact", external: false },
  );
  return list;
}
