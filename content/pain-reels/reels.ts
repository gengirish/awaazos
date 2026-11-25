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
  store: "kitchen" | "jewellery" | "clothing";
  /** The OWNER_PAINS key it answers; null for a Reel about selling more, which no survey pain names. */
  pain: string | null;
  /** Scene id of the film in demo-output/final. */
  film: string;
  /** Big line on the hook card, Hinglish, the way a seller says it. */
  hook: string;
  /** Smaller English line under it: what the film shows. */
  sub: string;
  /** Plain English name, for the app's cards and page titles (lib/pain-reels.ts). */
  title: string;
  /** Length of the rendered Reel, hook and end cards included. */
  seconds: number;
  /**
   * What the film's voice-over says, for the transcript under the player (the captions are
   * burned in). Leave it out when the film is a Help film: lib/pain-reels.ts reads that
   * film's HELP_VIDEOS lines, so the two never drift apart.
   */
  lines?: readonly string[];
};

export const PAIN_REELS: readonly PainReel[] = [
  {
    id: "orders_scattered",
    store: "kitchen",
    pain: "orders_scattered",
    film: "c1-buyer-order",
    hook: "DMs mein orders kho jaate hain?",
    sub: "Let buyers order from the link in your bio.",
    title: "Orders lost in DMs",
    seconds: 55,
  },
  {
    id: "payment_matching",
    store: "kitchen",
    pain: "payment_matching",
    film: "b4-check-upi-payment",
    hook: "Kisne pay kiya, kisne nahi?",
    sub: "Check each UPI payment with one tap.",
    title: "Who has paid?",
    seconds: 30,
  },
  {
    id: "overselling",
    store: "kitchen",
    pain: "overselling",
    film: "b1-speak-a-pre-order",
    hook: "Zyada orders le liye, ab bana nahi pa rahe?",
    sub: "Set how many you can make. Orders stop at your cut-off.",
    title: "Taking more orders than you can make",
    seconds: 47,
  },
  {
    id: "day_planning",
    store: "kitchen",
    pain: "day_planning",
    film: "b3-orders-board",
    hook: "Aaj kya banana hai, aur kiske liye?",
    sub: "Every order on one board, from New to Done.",
    title: "What to cook today, and for whom",
    seconds: 40,
  },
  {
    id: "same_questions",
    store: "kitchen",
    pain: "same_questions",
    film: "a3-speak-your-menu",
    hook: "Roz wahi sawaal: “Price kya hai?”",
    sub: "Say your menu once. Your store link answers for you.",
    title: "The same price question, every day",
    seconds: 41,
  },
  {
    id: "delivery",
    store: "kitchen",
    pain: "delivery",
    film: "b5-rider-handoff",
    hook: "Rider ko har baar address samjhana?",
    sub: "One tap sends him the address, items and cash to collect.",
    title: "Explaining the address to your rider",
    seconds: 42,
  },
  {
    id: "repeat_customers",
    store: "kitchen",
    pain: "repeat_customers",
    film: "c4-after-the-order",
    hook: "Purane customers wapas order nahi karte?",
    sub: "“Order again” fills their cart in one tap.",
    title: "Bringing buyers back",
    seconds: 38,
  },
  {
    id: "gst_invoices",
    store: "kitchen",
    pain: "gst_invoices",
    film: "f5-receipts",
    hook: "Customer ko proper bill chahiye?",
    sub: "A numbered receipt for every sale, on WhatsApp or printed.",
    title: "A proper bill for every sale",
    seconds: 29,
  },

  // ── Jewellery store (Moti Lane, lib/demo-fixture.ts "jewellery"; scenes g1–g6) ──
  {
    id: "jewellery-same_questions",
    store: "jewellery",
    pain: "same_questions",
    film: "g1-product-link",
    hook: "“Price pls?” DMs, din bhar?",
    sub: "Link each piece. Photo, price and colours open in one tap.",
    title: "Price questions in your DMs",
    seconds: 28,
    lines: [
      "A buyer likes your earrings in a post and taps the link.",
      "The piece opens on your store, with its photo and price.",
      "Nobody has to DM you to ask the price.",
      "They pick a colour, and see when only a few are left.",
      "One tap adds it to the cart.",
      "Close it, and the rest of your collection is right there.",
    ],
  },
  {
    id: "jewellery-orders_scattered",
    store: "jewellery",
    pain: "orders_scattered",
    film: "g2-buyer-order",
    hook: "DM mein order aaya, phir bhool gaye?",
    sub: "Buyers order from your bio link. Every order in one place.",
    title: "Orders lost in DMs",
    seconds: 55,
    lines: [
      "Your buyer taps the link in your Instagram bio.",
      "Your store opens: every piece, with photos and prices.",
      "They tap the jhumkas and pick a colour.",
      "Add a second piece, and the free pouch joins by itself.",
      "Checkout takes a few seconds.",
      "They pick pickup or delivery, and a time that suits you.",
      "One tap and the order is yours.",
      "They pay you straight on UPI. No commission.",
      "No more orders lost in your DMs.",
    ],
  },
  {
    id: "jewellery-overselling",
    store: "jewellery",
    pain: "overselling",
    film: "g3-last-piece",
    hook: "Ek hi piece do logon ko bech diya?",
    sub: "Stock counts itself. The last piece sells once.",
    title: "The same piece sold twice",
    seconds: 29,
    lines: [
      "One kundan choker left, and two buyers want it.",
      "Your store shows it: only one left.",
      "The first buyer orders it.",
      "Everyone else now sees Sold out.",
      "You never sell the same piece twice.",
      "Stock goes down with every order, by itself.",
    ],
  },
  {
    id: "jewellery-payment_matching",
    store: "jewellery",
    pain: "payment_matching",
    film: "g4-check-upi-payment",
    hook: "Kisne pay kiya, kisne nahi?",
    sub: "Check each UPI payment with one tap.",
    title: "Who has paid?",
    seconds: 32,
    lines: [
      "Buyers pay you straight on UPI, so no money passes through us.",
      "When they say they've paid, the order shows a payment to check.",
      "They sent the UPI reference. Match it in your UPI app.",
      "It's there? Tap Yes, received.",
      "The order is paid and accepted in one tap.",
      "Not in your app? Tap Not received, and they're asked for the reference again.",
    ],
  },
  {
    id: "jewellery-free-pouch",
    store: "jewellery",
    pain: null,
    film: "g5-free-pouch-offer",
    hook: "Sirf ek piece leke chale jaate hain?",
    sub: "A free pouch with 2 pieces. It joins the cart by itself.",
    title: "Getting buyers to take two pieces",
    seconds: 37,
    lines: [
      "Want buyers to take two pieces, not one?",
      "Add an offer: a free pouch with two pieces or more.",
      "Pick the gift from your own products.",
      "Save it, and it's live on your store.",
      "Buyers see it on your store, and the pouch joins their cart by itself.",
      "Switch it off any time with one tap.",
    ],
  },
  {
    id: "jewellery-ingredients",
    store: "jewellery",
    pain: "ingredients",
    film: "g6-received-stock",
    hook: "Kitna maal bacha, kitne mein liya?",
    sub: "Received stock and what you paid, on every piece.",
    title: "Stock left, and what you paid",
    seconds: 30,
    lines: [
      "New stock in from your supplier?",
      "Every piece shows how many you have left.",
      "Tap Received stock on the piece.",
      "Enter how many came in, and what you paid for each.",
      "Add it, and your stock goes up.",
      "Your cost and margin show on the piece, for you only.",
    ],
  },

  // ── Clothing store (Saanjh Threads, lib/demo-fixture.ts "clothing"; scenes w1–w6) ──
  {
    id: "clothing-same_questions",
    store: "clothing",
    pain: "same_questions",
    film: "w1-product-link",
    hook: "“Size available? Price?” DMs, din bhar?",
    sub: "Link each dress. Photo, price and sizes open in one tap.",
    title: "Size and price questions in your DMs",
    seconds: 35,
    lines: [
      "A buyer likes a dress in your post and taps the link.",
      "The dress opens on your store, with its photo and price.",
      "Nobody has to DM you to ask the price or the sizes.",
      "They pick their size, and see when only a few are left.",
      "One tap adds it to the cart.",
      "Close it, and the rest of your collection is right there.",
    ],
  },
  {
    id: "clothing-orders_scattered",
    store: "clothing",
    pain: "orders_scattered",
    film: "w2-buyer-order",
    hook: "DM mein order aaya, phir bhool gaye?",
    sub: "Buyers order from your bio link. Every order in one place.",
    title: "Orders lost in DMs",
    seconds: 58,
    lines: [
      "Your buyer taps the link in your Instagram bio.",
      "Your store opens: every outfit, with photos and prices.",
      "They tap the anarkali and pick their size.",
      "Add a dupatta, and the free potli bag joins by itself.",
      "Checkout takes a few seconds.",
      "They pick pickup or delivery, and a time that suits you.",
      "One tap and the order is yours.",
      "They pay you straight on UPI. No commission.",
      "No more orders lost in your DMs.",
    ],
  },
  {
    id: "clothing-overselling",
    store: "clothing",
    pain: "overselling",
    film: "w3-last-piece",
    hook: "Ek hi saree do logon ko bech di?",
    sub: "Stock counts itself. The last piece sells once.",
    title: "The same piece sold twice",
    seconds: 29,
    lines: [
      "One hand-painted saree left, and two buyers want it.",
      "Your store shows it: only one left.",
      "The first buyer orders it.",
      "Everyone else now sees Sold out.",
      "You never sell the same piece twice.",
      "Stock goes down with every order, by itself.",
    ],
  },
  {
    id: "clothing-payment_matching",
    store: "clothing",
    pain: "payment_matching",
    film: "w4-check-upi-payment",
    hook: "Kisne pay kiya, kisne nahi?",
    sub: "Check each UPI payment with one tap.",
    title: "Who has paid?",
    seconds: 32,
    lines: [
      "Buyers pay you straight on UPI, so no money passes through us.",
      "When they say they've paid, the order says Check payment.",
      "They sent the UPI reference. Match it in your UPI app.",
      "It's there? Tap Yes, received.",
      "The order is paid and accepted in one tap.",
      "Not in your app? Tap Not received, and they're asked for the reference again.",
    ],
  },
  {
    id: "clothing-free-potli",
    store: "clothing",
    pain: null,
    film: "w5-free-potli-offer",
    hook: "Sirf ek piece leke chale jaate hain?",
    sub: "A free potli with 2 pieces. It joins the cart by itself.",
    title: "Getting buyers to take two pieces",
    seconds: 38,
    lines: [
      "Want buyers to take two pieces, not one?",
      "Add an offer: a free potli bag with two pieces or more.",
      "Pick the gift from your own products.",
      "Save it, and it's live on your store.",
      "Buyers see it on your store, and the potli joins their cart by itself.",
      "Switch it off any time with one tap.",
    ],
  },
  {
    id: "clothing-ingredients",
    store: "clothing",
    pain: "ingredients",
    film: "w6-received-stock",
    hook: "Kitna maal bacha, kitne mein liya?",
    sub: "Received stock and what you paid, on every product.",
    title: "Stock left, and what you paid",
    seconds: 32,
    lines: [
      "New stock in from your weaver?",
      "Every product shows how many you have left.",
      "Tap Received stock on the product.",
      "Enter how many came in, and what you paid for each.",
      "Add it, and your stock goes up.",
      "Your cost and margin show on the product, for you only.",
    ],
  },
];
