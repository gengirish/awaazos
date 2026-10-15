/**
 * The WhatsApp messages an outreach admin sends a prospect about their demo
 * store (/admin/demo-stores and /new). Pure and client-safe.
 *
 * Nothing is sent from our side: the admin's own WhatsApp opens through a
 * wa.me link with the text filled in, they can edit it, and they tap send.
 * The text only states what is true for every demo: it was built for them,
 * it holds sample orders, nothing is live. Anything personal (what caught
 * the admin's eye on their page) is for the admin to add in the box.
 */
import { TRIAL_DAYS } from "@/lib/constants";
import { DEMO_CLAIM_TTL_DAYS } from "@/lib/demo-store-schema";
import { receiptWhatsappUrl } from "@/lib/whatsapp-message";

/** First word of a name, or "" — "Lahari Pruthvi" → "Lahari". */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

function greeting(ownerName: string | null | undefined): string {
  const first = firstName(ownerName);
  return first ? `Hi ${first},` : "Hi,";
}

function introduction(senderName: string | null | undefined): string {
  const first = firstName(senderName);
  return first ? `I'm ${first} from IntelliForge, the team behind AwaazOS.` : "I'm writing from IntelliForge, the team behind AwaazOS.";
}

/** First message: the demo store link and a 15-minute ask. */
export function outreachIntroMessage(input: {
  ownerName?: string | null;
  senderName?: string | null;
  storeName: string;
  storeUrl: string;
}): string {
  return [
    `${greeting(input.ownerName)} ${introduction(input.senderName)}`,
    `I set up a demo store for ${input.storeName}. Every custom order, advance and balance due sits in one list: ${input.storeUrl}`,
    "It's only a demo with sample orders, nothing is live and nothing is charged.",
    "Could we do 15 minutes this week? If it doesn't fit, I'd like to hear why.",
  ].join("\n\n");
}

/** After they say yes: the one-time claim link. */
export function outreachClaimMessage(input: {
  ownerName?: string | null;
  storeName: string;
  claimUrl: string;
  /** Shown as "until DD/MM/YYYY" when given. */
  expiresOn?: string | null;
}): string {
  const until = input.expiresOn ? `, until ${input.expiresOn}` : ` for ${DEMO_CLAIM_TTL_DAYS} days`;
  return [
    `${greeting(input.ownerName)} here is your link to make ${input.storeName} yours: ${input.claimUrl}`,
    `Choose your own password and the store moves to your account, with a ${TRIAL_DAYS}-day free trial. You can hide or delete the sample orders, and you add your own UPI ID before taking real orders.`,
    `The link works once${until}.`,
  ].join("\n\n");
}

/**
 * wa.me link for the admin's own WhatsApp. No phone → WhatsApp asks which
 * chat. null when the phone can't be a valid number.
 */
export function outreachWhatsappUrl(text: string, phone?: string | null): string | null {
  return receiptWhatsappUrl(text, phone);
}
