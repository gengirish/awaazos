/**
 * The WhatsApp message a seller sends another seller from Settings → Refer a
 * seller. Pure and client-safe; modelled on lib/outreach-message.ts.
 *
 * Nothing is sent from our side: the seller's own WhatsApp opens through a
 * `wa.me/?text=` link with no number (WhatsApp asks which chat), they can
 * edit the text, and they tap send. The text only states what is true for
 * every referral: the longer trial and the link. It never promises the
 * referrer's reward to the reader, and it never names the catalogue, so it
 * reads the same for a kitchen and any other store.
 */
import { TRIAL_DAYS } from "@/lib/constants";
import { REFERRED_TRIAL_DAYS } from "@/lib/referral";

/** Founder-to-founder note: who is writing, what AwaazOS does for them, the longer trial, the link. */
export function referralWhatsappMessage(input: { storeName: string; link: string }): string {
  const storeName = input.storeName.trim();
  const who = storeName ? `I run ${storeName} on AwaazOS.` : "I run my store on AwaazOS.";
  return [
    `Hi! ${who} Customers order and pay by UPI from one link, instead of in DMs, and I see every order on one board.`,
    `If you sell on Instagram or WhatsApp, try it for your store. Sign up with my link and you get ${REFERRED_TRIAL_DAYS} days free instead of ${TRIAL_DAYS}:`,
    input.link,
  ].join("\n\n");
}

/** wa.me link with no number, so WhatsApp asks which chat to send it to. */
export function referralWhatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** The link as printed on the story image: no scheme, no trailing slash. */
export function referralLinkLabel(link: string): string {
  return link.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
