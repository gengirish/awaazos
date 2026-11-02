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

const WHAT_WE_BUILD = "AwaazOS for home businesses that take orders on Instagram and WhatsApp.";

/** "Founder" only when it is true: everyone else on the team writes as themselves. */
function introduction(senderName: string | null | undefined, senderIsFounder: boolean): string {
  const first = firstName(senderName);
  if (!first) return `I'm writing from IntelliForge. We build ${WHAT_WE_BUILD}`;
  return senderIsFounder
    ? `I'm ${first}, founder of IntelliForge. I build ${WHAT_WE_BUILD}`
    : `I'm ${first} from IntelliForge. We build ${WHAT_WE_BUILD}`;
}

/**
 * First message: who is writing and for whom, the demo store link with what
 * the seller will see when they tap it (a store page with their items), what
 * it does for them, the trial, and a 15-minute ask.
 */
export function outreachIntroMessage(input: {
  ownerName?: string | null;
  senderName?: string | null;
  senderIsFounder?: boolean;
  storeName: string;
  storeUrl: string;
}): string {
  return [
    `${greeting(input.ownerName)} ${introduction(input.senderName, input.senderIsFounder ?? false)}`,
    `I made a demo store for ${input.storeName} with your items on it: ${input.storeUrl}`,
    "Customers order and pay by UPI there instead of in DMs, and you see every order, advance and balance due on one board.",
    "It's a demo with made-up orders. Nothing is live and nothing is charged.",
    `If it looks useful, the store is yours free for ${TRIAL_DAYS} days. Could we do 15 minutes this week? If it doesn't fit, I'd like to hear why.`,
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
