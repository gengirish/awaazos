/**
 * How the platform admin reaches a store's owners from /admin/vendors, to ask
 * for feedback and a testimonial. Pure and client-safe.
 *
 * Nothing is sent from our side: the admin's own email app (mailto) or
 * WhatsApp (wa.me) opens with the text filled in, and they edit and send it.
 * The ask says the quote is used only with the owner's written yes, which is
 * the rule `lib/proof-stories.ts` (`permission: true`) holds the landing page to.
 */
import { firstName } from "@/lib/outreach-message";
import { normaliseIndianMobile } from "@/lib/phone";

export type StoreOwnerContact = { name: string | null; email: string };

export type StoreContactInput = {
  /** Sign-up phone (`Vendor.phone`). */
  phone: string | null;
  /** Sign-up email (`Vendor.email`). */
  email: string | null;
  /** Business WhatsApp (`VendorSettings.whatsappNumber`). */
  whatsappNumber: string | null;
  /** Active OWNER staff, oldest first. */
  owners: StoreOwnerContact[];
};

export type StoreContact = {
  /** Name to greet: the first owner's account name, if any. */
  ownerName: string | null;
  /** Every distinct email, lower-cased: owners' sign-in emails, then the store's. */
  emails: string[];
  /** Distinct numbers as saved, WhatsApp first: the one to message. */
  phones: { number: string; label: "WhatsApp" | "Sign-up phone" }[];
};

function sameNumber(a: string, b: string): boolean {
  return normaliseIndianMobile(a) === normaliseIndianMobile(b);
}

export function storeContact(input: StoreContactInput): StoreContact {
  const emails: string[] = [];
  for (const raw of [...input.owners.map((o) => o.email), input.email]) {
    const e = raw?.trim().toLowerCase();
    if (e && !emails.includes(e)) emails.push(e);
  }

  const phones: StoreContact["phones"] = [];
  const wa = input.whatsappNumber?.trim();
  const signUp = input.phone?.trim();
  if (wa) phones.push({ number: wa, label: "WhatsApp" });
  if (signUp && !(wa && sameNumber(wa, signUp))) phones.push({ number: signUp, label: "Sign-up phone" });

  const ownerName = input.owners.find((o) => o.name?.trim())?.name?.trim() ?? null;
  return { ownerName, emails, phones };
}

export const FEEDBACK_EMAIL_SUBJECT = "How is AwaazOS working for you?";

/**
 * The ask: how it is going, what is hard, and whether a line from them may go
 * on our site, only once they say yes in writing.
 */
export function feedbackRequestMessage(opts: {
  ownerName: string | null;
  storeName: string;
  senderName: string | null;
}): string {
  const owner = firstName(opts.ownerName);
  const sender = firstName(opts.senderName);
  return [
    owner ? `Hi ${owner},` : "Hi,",
    "",
    `${sender ? `I'm ${sender} from` : "I'm writing from"} AwaazOS. Thank you for running ${opts.storeName} on it.`,
    "",
    "Could you tell me in a few lines how it is going? What works for you, and what is hard or missing?",
    "",
    "If you are happy with it, may we quote a line or two from you, with your store's name, on our website? We will only use it after you say yes in writing, and you can ask us to take it down at any time.",
    "",
    "Thank you,",
    sender || "AwaazOS",
  ].join("\n");
}

/** A mailto link with the subject and text filled in; several emails go in To. */
export function feedbackMailtoUrl(emails: string[], body: string): string | null {
  if (emails.length === 0) return null;
  // Sign-up emails are validated, so they go in as they are (an encoded "@" trips some mail apps).
  return `mailto:${emails.join(",")}?subject=${encodeURIComponent(FEEDBACK_EMAIL_SUBJECT)}&body=${encodeURIComponent(body)}`;
}
