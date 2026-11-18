import type { StoreKind } from "@/lib/store-vocabulary";

/**
 * Short narrated videos for the in-app Help page (`/help`), one per job.
 * Pure and client-safe, like lib/help-guide.ts.
 *
 * The films are recorded by the Playwright demo pipeline (docs/DEMO_VIDEOS_PLAN.md)
 * and published with `npm run help-videos:publish` to one public folder:
 * `<HELP_VIDEO_BASE_URL>/<id>.mp4` and `<id>.jpg` (poster). Unset base → the page
 * shows no video buttons at all, so nothing points at a missing file.
 *
 * `kinds`: a film shot in a kitchen says "dish" and "menu", so it is offered to
 * food stores only; a film whose words fit any store is offered to both.
 * `lines`: what the voice-over says, shown under the video as its transcript
 * (the captions are burned into the picture, so a screen reader needs these).
 * Keep them in step with the scene's captions when a film is re-recorded.
 */

export type HelpVideo = {
  /** File name without extension, and the scene's id in demo/scenes/. */
  id: string;
  title: string;
  seconds: number;
  kinds: readonly StoreKind[];
  /** "How do I…" topics (HELP_TOPICS ids) that offer this film. */
  topics: readonly string[];
  /** "An online order, start to finish" steps (ORDER_JOURNEY ids) that offer it. */
  journey?: readonly string[];
  lines: readonly string[];
};

const FOOD: readonly StoreKind[] = ["food"];
const ANY: readonly StoreKind[] = ["food", "goods"];

export const HELP_VIDEOS: readonly HelpVideo[] = [
  {
    id: "f3-tap-billing-cash",
    title: "Ring up a sale and take cash",
    seconds: 37,
    kinds: FOOD,
    topics: ["ring-up-sale"],
    lines: [
      "A customer at your door? Ring them up on the counter screen.",
      "Tap a dish once for each plate.",
      "The bill adds itself up as you go.",
      "They pay cash, so switch to Cash.",
      "Tap the note they hand you, and see the change to give back.",
      "Mark it paid and the bill number is ready.",
      "Tapped by mistake? Undo it within five seconds.",
      "The order comes back, ready to fix and charge again.",
    ],
  },
  {
    id: "f1-bill-by-voice",
    title: "Bill by speaking the order",
    seconds: 38,
    kinds: FOOD,
    topics: ["ring-up-sale"],
    lines: [
      "A customer at your counter? Just say the order.",
      "Tap the mic and speak, in Hindi or English.",
      "“Ek veg thali aur do sweet lassi.”",
      "The bill is ready before you put the phone down.",
      "Collect the payment.",
      "Your UPI QR shows the exact amount. The customer scans and pays you.",
      "Once the money is in, mark it paid.",
      "Every sale gets a bill number, ready to send on WhatsApp.",
    ],
  },
  {
    id: "f5-receipts",
    title: "Send or print a receipt",
    seconds: 31,
    kinds: ANY,
    topics: ["send-receipt", "resend-receipt"],
    lines: [
      "Every sale gets a proper receipt with its own bill number.",
      "Send it on WhatsApp from your own number in one tap.",
      "Need paper? Print it on a 58 millimetre thermal printer.",
      "Your customer gets the same receipt as a link on their phone.",
      "They can save it as a PDF whenever they need it.",
    ],
  },
  {
    id: "f4-works-offline",
    title: "Keep selling with no internet",
    seconds: 44,
    kinds: FOOD,
    topics: ["sell-offline"],
    lines: [
      "The network drops in the middle of a busy lunch.",
      "Your counter screen says so, and keeps working.",
      "Tap the order in as usual.",
      "The sale is saved on your phone as Offline number one.",
      "It waits there safely until the network is back.",
      "Back online, it syncs by itself.",
      "Your sale is in your bills with its own bill number.",
      "No sale is lost, and none is counted twice.",
    ],
  },
  {
    id: "b3-orders-board",
    title: "Work your orders board",
    seconds: 43,
    kinds: FOOD,
    topics: ["see-orders"],
    lines: [
      "Every order lands on one board, on your phone.",
      "New orders wait at the top, with what to cook and when.",
      "Accept an order and it moves to Preparing.",
      "Food's packed? Mark it ready.",
      "When they pick it up, one tap books the cash.",
      "The line at the top keeps count of what's paid and what's left to collect.",
      "Two more orders are waiting under New.",
    ],
  },
  {
    id: "b4-check-upi-payment",
    title: "Check a UPI payment",
    seconds: 27,
    kinds: ANY,
    topics: ["check-payment"],
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
    id: "b5-rider-handoff",
    title: "Send an order with your rider",
    seconds: 41,
    kinds: ANY,
    topics: ["rider-handoff", "deliver-order"],
    journey: ["send"],
    lines: [
      "A delivery order is cooked and packed.",
      "Save your riders once, and each order gets a Send to Ravi button.",
      "One tap sends the address, the items and the cash to collect on WhatsApp.",
      "The order moves to Ready, out for delivery with your rider.",
      "The message ends with the rider's own link.",
      "It shows the door, the phone number and the cash to collect.",
      "At the door, the rider taps Delivered.",
      "Done: the cash is booked, and the buyer's details leave the rider's phone.",
    ],
  },
  {
    id: "b1-speak-a-pre-order",
    title: "Create a pre-order by speaking",
    seconds: 46,
    kinds: FOOD,
    topics: ["new-drop"],
    lines: [
      "Cooking something special this week? Take orders before you cook.",
      "Tap the mic and say what you're making, the price and when.",
      "“Parson 15 veg biryani 200 rupaye, 10 chicken curry, pickup 12:30 se 2:30, order kal raat 9 tak.”",
      "The whole form fills itself. Everything it heard is marked.",
      "How many you can make is set too, so you never take too many orders.",
      "Check it, then open orders.",
      "It's live on your store. Orders stop by themselves at the cut-off.",
      "Copy the message and post it on WhatsApp and Instagram.",
    ],
  },
  {
    id: "a3-speak-your-menu",
    title: "Add dishes by speaking",
    seconds: 38,
    kinds: FOOD,
    topics: ["voice-menu"],
    lines: [
      "New dishes this week? Don't type them. Say them.",
      "Tap the mic and read out your dishes with their prices.",
      "“Rajma chawal 160, kadhi pakoda 150, gajar halwa, aur aloo paratha ab 130.”",
      "Every dish comes back as a row you can check.",
      "Forgot a price? It asks you for it.",
      "Said a new price for an old dish? It updates that one.",
      "Save, and they are on your menu.",
      "Photos and descriptions can come later.",
    ],
  },
  {
    id: "d1-a-sale",
    title: "Start a sale",
    seconds: 50,
    kinds: FOOD,
    topics: ["offers"],
    lines: [
      "Festival coming up? Start a sale in a minute.",
      "Give it a name your buyers will see.",
      "Every dish counts, from one plate up.",
      "Save it, and it's live on your store.",
      "Switch it off any time with one tap.",
      "Your buyers see the sale right on your store.",
      "Old prices struck out, sale prices beside them.",
      "The bill takes the discount by itself.",
    ],
  },
  {
    id: "c1-buyer-order",
    title: "How a customer orders",
    seconds: 60,
    kinds: FOOD,
    topics: [],
    journey: ["place"],
    lines: [
      "Your buyer taps the link in your Instagram bio.",
      "Your own store opens: your menu, photos and prices.",
      "They tap a dish to see it up close.",
      "Add a second meal and the free lassi joins the order by itself.",
      "Checkout takes a few seconds.",
      "They pick pickup or delivery, and a time that suits you.",
      "One tap and the order is yours.",
      "They pay you straight on UPI. No commission.",
      "Their order page shows every step until it's ready.",
    ],
  },
  {
    id: "c2-pay-by-upi",
    title: "How a customer pays by UPI",
    seconds: 27,
    kinds: ANY,
    topics: [],
    journey: ["pay"],
    lines: [
      "Your buyer's order is in. Now they pay you.",
      "The amount and your UPI ID are already on the page.",
      "One tap opens their UPI app with the amount filled in.",
      "The money goes straight to your bank. No commission.",
      "Back here, they tap Payment done.",
      "You check your UPI app, then confirm with one tap.",
      "Their order page waits for your yes.",
    ],
  },
  {
    id: "c4-after-the-order",
    title: "What the customer sees after ordering",
    seconds: 39,
    kinds: FOOD,
    topics: [],
    journey: ["received"],
    lines: [
      "Your buyer keeps their order page open.",
      "It shows every step, so they never need to call you.",
      "When you send it out, one tap shows them the news.",
      "When it arrives, they tell you with one tap.",
      "Then they rate it. You read every word.",
      "Next time, Order again fills the cart in one tap.",
      "Same dishes, same address. Happy buyers come back.",
    ],
  },
];

/** A film ready to play: its files resolved against the published folder. */
export type ResolvedHelpVideo = Pick<HelpVideo, "id" | "title" | "seconds" | "lines"> & {
  src: string;
  poster: string;
};

/** The published folder, without a trailing slash; null when unset or not an http(s) URL / site path. */
export function helpVideoBase(raw: string | undefined): string | null {
  const base = raw?.trim().replace(/\/+$/, "");
  if (!base) return null;
  if (base.startsWith("/") && !base.startsWith("//")) return base;
  try {
    const url = new URL(base);
    return url.protocol === "https:" || url.protocol === "http:" ? base : null;
  } catch {
    return null;
  }
}

/** "40 s", "1 min" */
export function formatVideoLength(seconds: number): string {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
}

function resolve(video: HelpVideo, base: string): ResolvedHelpVideo {
  return {
    id: video.id,
    title: video.title,
    seconds: video.seconds,
    lines: video.lines,
    src: `${base}/${video.id}.mp4`,
    poster: `${base}/${video.id}.jpg`,
  };
}

export type HelpVideosForStore = {
  /** Every film this store is offered, in HELP_VIDEOS order: the row at the top of the page. */
  list: ResolvedHelpVideo[];
  /** The films each "How do I…" topic offers, keyed by topic id. */
  topics: Record<string, ResolvedHelpVideo[]>;
  /** The films each journey step offers, keyed by step id. */
  journey: Record<string, ResolvedHelpVideo[]>;
};

/**
 * The films this store is offered: all of them, and per topic and journey step.
 * Empty when no folder is published. The page looks topics up only by the ids it
 * shows, so a topic trimmed for a cashier never surfaces a film there.
 */
export function helpVideosFor(kind: StoreKind, rawBase: string | undefined): HelpVideosForStore {
  const list: ResolvedHelpVideo[] = [];
  const topics: Record<string, ResolvedHelpVideo[]> = {};
  const journey: Record<string, ResolvedHelpVideo[]> = {};
  const base = helpVideoBase(rawBase);
  if (!base) return { list, topics, journey };
  for (const video of HELP_VIDEOS) {
    if (!video.kinds.includes(kind)) continue;
    const resolved = resolve(video, base);
    list.push(resolved);
    for (const id of video.topics) (topics[id] ??= []).push(resolved);
    for (const id of video.journey ?? []) (journey[id] ??= []).push(resolved);
  }
  return { list, topics, journey };
}
