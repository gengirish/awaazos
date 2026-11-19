/**
 * Pain-point Reels: one short film per problem sellers name on the owner survey
 * (OWNER_PAINS in lib/owner-survey.ts, also public at /survey).
 *
 * Each Reel is a hook card in the seller's own words, then a recorded demo film
 * (docs/DEMO_VIDEOS_PLAN.md, the same films the Help page plays), then an end card.
 * Built by `npm run pain-reels:render`. Captions to post with them: CAPTIONS.md.
 *
 * Only pains a film really shows get a Reel. A hook promises what the film
 * shows, nothing more: the profit report is not built, so there is no profit Reel.
 */
export type PainReel = {
  /** Output file name: `<id>.mp4`, `<id>.cover.jpg`. */
  id: string;
  /** Which store the film shows, so the cards take its colour. */
  store: "kitchen" | "jewellery";
  /** The OWNER_PAINS key it answers; null for a Reel about selling more, which no survey pain names. */
  pain: string | null;
  /** Scene id of the film in demo-output/final. */
  film: string;
  /** Big line on the hook card, Hinglish, the way a seller says it. */
  hook: string;
  /** Smaller English line under it: what the film shows. */
  sub: string;
};

export const PAIN_REELS: readonly PainReel[] = [
  {
    id: "orders_scattered",
    store: "kitchen",
    pain: "orders_scattered",
    film: "c1-buyer-order",
    hook: "DMs mein orders kho jaate hain?",
    sub: "Let buyers order from the link in your bio.",
  },
  {
    id: "payment_matching",
    store: "kitchen",
    pain: "payment_matching",
    film: "b4-check-upi-payment",
    hook: "Kisne pay kiya, kisne nahi?",
    sub: "Check each UPI payment with one tap.",
  },
  {
    id: "overselling",
    store: "kitchen",
    pain: "overselling",
    film: "b1-speak-a-pre-order",
    hook: "Zyada orders le liye, ab bana nahi pa rahe?",
    sub: "Set how many you can make. Orders stop at your cut-off.",
  },
  {
    id: "day_planning",
    store: "kitchen",
    pain: "day_planning",
    film: "b3-orders-board",
    hook: "Aaj kya banana hai, aur kiske liye?",
    sub: "Every order on one board, from New to Done.",
  },
  {
    id: "same_questions",
    store: "kitchen",
    pain: "same_questions",
    film: "a3-speak-your-menu",
    hook: "Roz wahi sawaal: “Price kya hai?”",
    sub: "Say your menu once. Your store link answers for you.",
  },
  {
    id: "delivery",
    store: "kitchen",
    pain: "delivery",
    film: "b5-rider-handoff",
    hook: "Rider ko har baar address samjhana?",
    sub: "One tap sends him the address, items and cash to collect.",
  },
  {
    id: "repeat_customers",
    store: "kitchen",
    pain: "repeat_customers",
    film: "c4-after-the-order",
    hook: "Purane customers wapas order nahi karte?",
    sub: "“Order again” fills their cart in one tap.",
  },
  {
    id: "gst_invoices",
    store: "kitchen",
    pain: "gst_invoices",
    film: "f5-receipts",
    hook: "Customer ko proper bill chahiye?",
    sub: "A numbered receipt for every sale, on WhatsApp or printed.",
  },

  // ── Jewellery store (Moti Lane, lib/demo-fixture.ts "jewellery"; scenes g1–g6) ──
  {
    id: "jewellery-same_questions",
    store: "jewellery",
    pain: "same_questions",
    film: "g1-product-link",
    hook: "“Price pls?” DMs, din bhar?",
    sub: "Link each piece. Photo, price and colours open in one tap.",
  },
  {
    id: "jewellery-orders_scattered",
    store: "jewellery",
    pain: "orders_scattered",
    film: "g2-buyer-order",
    hook: "DM mein order aaya, phir bhool gaye?",
    sub: "Buyers order from your bio link. Every order in one place.",
  },
  {
    id: "jewellery-overselling",
    store: "jewellery",
    pain: "overselling",
    film: "g3-last-piece",
    hook: "Ek hi piece do logon ko bech diya?",
    sub: "Stock counts itself. The last piece sells once.",
  },
  {
    id: "jewellery-payment_matching",
    store: "jewellery",
    pain: "payment_matching",
    film: "g4-check-upi-payment",
    hook: "Kisne pay kiya, kisne nahi?",
    sub: "Check each UPI payment with one tap.",
  },
  {
    id: "jewellery-free-pouch",
    store: "jewellery",
    pain: null,
    film: "g5-free-pouch-offer",
    hook: "Sirf ek piece leke chale jaate hain?",
    sub: "A free pouch with 2 pieces. It joins the cart by itself.",
  },
  {
    id: "jewellery-ingredients",
    store: "jewellery",
    pain: "ingredients",
    film: "g6-received-stock",
    hook: "Kitna maal bacha, kitne mein liya?",
    sub: "Received stock and what you paid, on every piece.",
  },
];
