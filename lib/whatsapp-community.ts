/**
 * The seller's own WhatsApp group invite or channel link, shown on the public
 * storefront and the buyer's order page (`VendorSettings.whatsappCommunityUrl`).
 * Pure string work, safe in client components.
 *
 * Buyers join it themselves: we never send to the group, read it or learn who
 * joined. Only two kinds of link are accepted, so a saved value can never point
 * a buyer anywhere else:
 *   https://chat.whatsapp.com/<invite code>       a group (or community) invite
 *   https://whatsapp.com/channel/<channel id>     a channel
 * Stored canonical (https, no query); codes are case-sensitive, so case is kept.
 */

export const WHATSAPP_COMMUNITY_MESSAGE =
  "Paste a WhatsApp group invite link (chat.whatsapp.com/…) or a channel link (whatsapp.com/channel/…).";

export type WhatsappCommunityKind = "group" | "channel";

const CODE = "([A-Za-z0-9]{16,40})";
const TAIL = "\\/?(?:[?#].*)?$";
const GROUP_INPUT = new RegExp(`^(?:https?:\\/\\/)?chat\\.whatsapp\\.com\\/(?:invite\\/)?${CODE}${TAIL}`, "i");
const CHANNEL_INPUT = new RegExp(`^(?:https?:\\/\\/)?(?:www\\.)?whatsapp\\.com\\/channel\\/${CODE}${TAIL}`, "i");
const GROUP_STORED = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{16,40}$/;
const CHANNEL_STORED = /^https:\/\/whatsapp\.com\/channel\/[A-Za-z0-9]{16,40}$/;

/**
 * What a seller pastes ("chat.whatsapp.com/AbC…?mode=ems_copy_t") → the stored
 * link ("https://chat.whatsapp.com/AbC…"). "" for blank input (clears the
 * field), null when it is not a group invite or channel link.
 */
export function normaliseWhatsappCommunityUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return "";
  const group = GROUP_INPUT.exec(value);
  if (group) return `https://chat.whatsapp.com/${group[1]}`;
  const channel = CHANNEL_INPUT.exec(value);
  if (channel) return `https://whatsapp.com/channel/${channel[1]}`;
  return null;
}

/** The link and its kind for a stored value, or null when the stored value is not a usable link. */
export function whatsappCommunityLink(
  stored: string | null | undefined,
): { href: string; kind: WhatsappCommunityKind } | null {
  if (!stored) return null;
  if (GROUP_STORED.test(stored)) return { href: stored, kind: "group" };
  if (CHANNEL_STORED.test(stored)) return { href: stored, kind: "channel" };
  return null;
}

/** Button text: "Join our WhatsApp group" / "Follow our WhatsApp channel". */
export function whatsappCommunityLabel(kind: WhatsappCommunityKind): string {
  return kind === "group" ? "Join our WhatsApp group" : "Follow our WhatsApp channel";
}
