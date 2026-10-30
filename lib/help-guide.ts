import type { StaffRole } from "@prisma/client";

import { APP_NAV_ITEMS, appNavItemsForRole, appTabBarForRole, type AppNavId, type AppNavItem } from "@/lib/app-nav";

/**
 * Content of the in-app Help page (`/help`): what each screen is for and where
 * to go for a given job. Pure and client-safe, like lib/app-nav.ts, and built
 * on that list — a screen a role can't see in the navigation is never
 * mentioned to it here.
 *
 * Wording rule: name buttons exactly as the screen shows them ("Collect
 * payment", "Prep sheet"), so a vendor can match the words to what they see.
 */

/** One line per destination, in the words of someone running a kitchen. */
export const HELP_SCREEN_SUMMARY: Record<AppNavId, string> = {
  orders: "Every online order, from your menu and from your drops: confirm them, check payments and mark them delivered.",
  drops: "Pre-order batches with a cut-off. Create and edit drops here; their orders come in on the Orders screen.",
  sell: "The counter. Ring up a sale by tapping or by voice, and take payment.",
  menu: "Your dishes: names, prices, photos and what is available today.",
  transactions: "Every bill you have made. Search, resend a receipt, or export.",
  analytics: "Sales totals, best-selling dishes and busy hours.",
  settings: "Your online store, payments, receipts, alerts and plan.",
  help: "This guide.",
};

/**
 * "An online order, start to finish": the whole life of one storefront order
 * as the Help page tells it, in order. Every role sees it (the Orders screen
 * is everyone's); button names are quoted exactly as the screens show them.
 */
export type OrderJourneyStep = {
  id: string;
  /** Who does this step. */
  who: "Customer" | "You" | "Rider";
  title: string;
  text: string;
  /** When the step only applies to some orders. */
  when?: string;
};

export const ORDER_JOURNEY: readonly OrderJourneyStep[] = [
  {
    id: "place",
    who: "Customer",
    title: "Places the order",
    text: "On your store page they pick dishes, choose delivery or pickup, and pay by UPI now or on delivery. Your phone gets an alert and the order appears on Orders under Needs action.",
  },
  {
    id: "pay",
    who: "Customer",
    title: "Pays and taps I've paid",
    when: "UPI orders",
    text: "They pay from their UPI app, then tap I've paid, with the UPI reference or a screenshot of the payment if they have one. Open the screenshot from the order card, but check your UPI app and tap Payment received, or Not received if it isn't there. Their tap never marks the order paid by itself.",
  },
  {
    id: "confirm",
    who: "You",
    title: "Confirm",
    text: "Tap Confirm so the customer knows you have it. Their order page says Confirmed. A paid order is confirmed for you: Payment received does both.",
  },
  {
    id: "send",
    who: "You",
    title: "Hand it to your rider",
    when: "Deliveries",
    text: "Tap Send to and your rider's name (save riders in Settings, Online orders). WhatsApp opens to the rider with the name, phone, address, items and cash to collect, and the order is marked Out for delivery: the customer's page says On the way. Using Porter or Rapido? Tap Copy for rider and paste it there, then Out for delivery.",
  },
  {
    id: "door",
    who: "Rider",
    title: "Delivers and taps Delivered",
    when: "Deliveries",
    text: "At the door the rider collects any cash due, then opens the link at the end of their message and taps Delivered. Your Orders screen updates by itself.",
  },
  {
    id: "received",
    who: "Customer",
    title: "Can tap I've received my order",
    when: "Deliveries",
    text: "If it is already paid, the order is finished for you. If it is pay on delivery, the card says Customer got it so you can make sure the cash reached you.",
  },
  {
    id: "finish",
    who: "You",
    title: "Finish the order",
    text: "If nobody tapped Delivered, tap Delivered or Picked up yourself. For a pay-on-delivery order the button says Delivered · and the amount collected, and marks it paid. Tapped it by mistake? Use Undo.",
  },
];

export type HelpGroupId = "counter" | "orders" | "drops" | "menu" | "records" | "setup";

export const HELP_GROUPS: readonly { id: HelpGroupId; title: string }[] = [
  { id: "counter", title: "Selling at the counter" },
  { id: "orders", title: "Online orders" },
  { id: "drops", title: "Drops (pre-orders)" },
  { id: "menu", title: "Menu" },
  { id: "records", title: "Bills and reports" },
  { id: "setup", title: "Store setup" },
];

export type HelpTopic = {
  id: string;
  group: HelpGroupId;
  /** The job, phrased as the vendor would say it. */
  title: string;
  /** What to do once there. One or two short sentences. */
  steps: string;
  /** The destination this lives under; decides who sees the topic. */
  nav: AppNavId;
  /** Where the link goes. Defaults to the destination itself. */
  href?: string;
  /** Steps after the destination, e.g. `["Payments"]` under Settings. */
  trail?: readonly string[];
  /** Only an OWNER can change this; other staff can look. */
  ownerOnly?: boolean;
  /** Extra words people search by that the title and steps don't contain. */
  keywords?: string;
};

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "ring-up-sale",
    group: "counter",
    title: "Ring up a sale",
    steps: "Tap dishes under Quick add, or tap the mic and say the order. Check the cart, then tap Collect payment.",
    nav: "sell",
    keywords: "pos bill voice speak cart checkout upi qr cash",
  },
  {
    id: "send-receipt",
    group: "counter",
    title: "Send the receipt to a customer",
    steps: "After the sale, tap Send on WhatsApp. It opens your own WhatsApp with the bill ready to send.",
    nav: "sell",
    keywords: "bill message share",
  },
  {
    id: "sell-offline",
    group: "counter",
    title: "Sell when the internet is down",
    steps: "Keep selling as usual. Each sale is saved on this phone as Offline #1, #2… and is sent by itself once you are back online.",
    nav: "sell",
    keywords: "no network wifi sync unsynced",
  },
  {
    id: "see-orders",
    group: "orders",
    title: "See new online orders",
    steps: "Every online order is listed here, newest first, whether it came from your everyday menu or from a drop. If you take both, the picker at the top narrows the list to menu orders or to one drop.",
    nav: "orders",
    keywords: "storefront board incoming",
  },
  {
    id: "check-payment",
    group: "orders",
    title: "Confirm that a customer has paid",
    steps: "When a customer says they have paid, check your UPI app, then tap Payment received. If the money has not arrived, tap Not received.",
    nav: "orders",
    keywords: "upi utr reference claim paid verify",
  },
  {
    id: "deliver-order",
    group: "orders",
    title: "Mark an order as delivered",
    steps: "Tap Delivered on the order. To finish several at once, select them and use the bar that appears under the list. Your rider can also tap Delivered on the link in their message, and a customer can tap I've received my order: a paid order is then finished for you, and an unpaid one shows Customer got it so you can collect the payment.",
    nav: "orders",
    keywords: "complete done pickup bulk cash on delivery collected rider link received customer got it",
  },
  {
    id: "rider-handoff",
    group: "orders",
    title: "Send a delivery to Porter, Rapido or your rider",
    steps: "Tap Copy for rider on a delivery order and paste it into the booking app. It has the name, phone, address, items and any cash to collect. The drop's Prep sheet has the same button. If you saved your own riders in Settings, tap Send to and the rider's name: WhatsApp opens to them with the order filled in, and the order is marked Out for delivery. Your customer's order page then says On the way. No saved rider? Tap Out for delivery yourself once it leaves. The message ends with a link for the rider: they tap Delivered on it at the door and your board updates.",
    nav: "orders",
    keywords: "dunzo courier driver address booking cash collect handover whatsapp send out for delivery on the way dispatch",
  },
  {
    id: "share-store",
    group: "orders",
    title: "Share your store on Instagram",
    steps: "With Order from menu on, the Orders screen has Share store link and Instagram story, a ready-made image of your menu (on a phone, tap Share first).",
    nav: "orders",
    keywords: "post link promote story bio",
  },
  {
    id: "new-drop",
    group: "drops",
    title: "Create a drop",
    steps: "Tap New drop. Add the dishes, how many you can make, the pickup or delivery time and the order cut-off. You can also speak the plan.",
    nav: "drops",
    href: "/drops/new",
    trail: ["New drop"],
    keywords: "pre-order preorder batch schedule cutoff stock",
  },
  {
    id: "drop-orders",
    group: "drops",
    title: "See the orders for a drop",
    steps: "Drop orders are on the Orders screen with all your other orders. Choose the drop in the picker at the top to see only its orders. Tapping a drop on the Drops screen opens the same list.",
    nav: "orders",
    trail: ["choose the drop"],
    keywords: "board preorder",
  },
  {
    id: "prep-sheet",
    group: "drops",
    title: "Find out how much to cook",
    steps: "Choose the drop on the Orders screen, then Prep sheet. It adds up every dish across the drop's orders, ready to print.",
    nav: "orders",
    trail: ["choose the drop", "Prep sheet"],
    keywords: "quantities totals kitchen print cooking list",
  },
  {
    id: "share-drop",
    group: "drops",
    title: "Share a drop on Instagram",
    steps: "Choose the drop on the Orders screen and tap Instagram story for a ready-made story image, or Share to send its link.",
    nav: "orders",
    trail: ["choose the drop", "Instagram story"],
    keywords: "post link promote",
  },
  {
    id: "edit-menu",
    group: "menu",
    title: "Add a dish or change a price",
    steps: "Tap Add item for a new dish, or Edit on a dish to change its name, price, photo and category.",
    nav: "menu",
    keywords: "item rate cost picture image",
  },
  {
    id: "voice-menu",
    group: "menu",
    title: "Add many dishes by speaking",
    steps: "Open Add dishes by voice at the top of the Menu screen and say each dish with its price. Check the list it shows before you save.",
    nav: "menu",
    keywords: "voice mic bulk list",
  },
  {
    id: "sold-out",
    group: "menu",
    title: "Mark a dish as sold out",
    steps: "Tap Selling on the dish so it reads Sold out. It stays off Sell and your online store until you switch it back.",
    nav: "menu",
    keywords: "unavailable hide out of stock availability",
  },
  {
    id: "find-bill",
    group: "records",
    title: "Find an old bill",
    steps: "Set the From and To dates, and narrow by status or payment method. Tap a bill to see what was on it.",
    nav: "transactions",
    keywords: "history past sale invoice receipt search",
  },
  {
    id: "resend-receipt",
    group: "records",
    title: "Resend a receipt",
    steps: "Tap the bill to open it, then tap Send on WhatsApp or Resend on WhatsApp.",
    nav: "transactions",
    keywords: "bill again copy",
  },
  {
    id: "export-csv",
    group: "records",
    title: "Download your sales as a spreadsheet",
    steps: "Choose the dates and tap Export CSV. The file opens in Excel or Google Sheets.",
    nav: "transactions",
    keywords: "excel accounts accountant download report gst",
  },
  {
    id: "sales-report",
    group: "records",
    title: "See how sales are going",
    steps: "Pick a period to see total sales, your best-selling dishes and your busiest hours.",
    nav: "analytics",
    keywords: "revenue report today week month top items",
  },
  {
    id: "publish-store",
    group: "setup",
    title: "Put your store online and get its link",
    steps: "Turn the online store on, then tap Copy link and paste it in your Instagram bio.",
    nav: "settings",
    href: "/settings/store",
    trail: ["Online store"],
    ownerOnly: true,
    keywords: "storefront publish url share",
  },
  {
    id: "store-link",
    group: "setup",
    title: "Choose or change your store link",
    steps: "You picked the link (awaazos.in/s/your-name) at sign-up. To change it, edit Store link and save. The old link stops working, so update your Instagram bio and any QR code.",
    nav: "settings",
    href: "/settings/store",
    trail: ["Online store"],
    ownerOnly: true,
    keywords: "url handle slug address rename bio",
  },
  {
    id: "store-look",
    group: "setup",
    title: "Change your store name, banner or logo",
    steps: "Edit the name and upload a banner and logo. Customers see them at the top of your store.",
    nav: "settings",
    href: "/settings/store",
    trail: ["Online store"],
    ownerOnly: true,
    keywords: "photo picture brand rename",
  },
  {
    id: "store-details",
    group: "setup",
    title: "Change what you sell or where you are",
    steps: "Under Store type & location, pick what you sell (or Other, and describe it) and type your area, city and state. Leave one blank to hide it.",
    nav: "settings",
    href: "/settings/store",
    trail: ["Online store"],
    ownerOnly: true,
    keywords: "type category business other city state location address place",
  },
  {
    id: "community-page",
    group: "setup",
    title: "Join your society's community page",
    steps: "When your housing society has a page that lists its home kitchens, the invite shows under Community pages. Tap Join to be listed, or Leave later. Customers still order on your own store.",
    nav: "settings",
    href: "/settings/store",
    trail: ["Online store"],
    ownerOnly: true,
    keywords: "society apartment rwa community neighbours directory list",
  },
  {
    id: "menu-orders",
    group: "setup",
    title: "Let customers order from your everyday menu",
    steps: "Turn on ordering from the menu and choose pickup, delivery or both, with a delivery fee if you charge one.",
    nav: "settings",
    href: "/settings/orders",
    trail: ["Online orders"],
    ownerOnly: true,
    keywords: "whatsapp pickup delivery fee",
  },
  {
    id: "delivery-riders",
    group: "setup",
    title: "Save your delivery riders",
    steps: "Add each person who delivers for you with their WhatsApp number, up to 5. Delivery orders then get a Send to button for each of them.",
    nav: "settings",
    href: "/settings/orders",
    trail: ["Online orders"],
    ownerOnly: true,
    keywords: "rider delivery boy driver whatsapp phone staff",
  },
  {
    id: "offers",
    group: "setup",
    title: "Give a discount on bigger orders",
    steps:
      "Create an offer with a minimum quantity and a percentage off. Tag items on the Menu page to choose which ones count. The discount is applied for you in your online store, in drops and at the counter.",
    nav: "settings",
    href: "/settings/offers",
    trail: ["Offers"],
    keywords: "discount plan combo bundle weekly percent off tag",
  },
  {
    id: "payment-setup",
    group: "setup",
    title: "Set your UPI ID and how customers pay",
    steps:
      "Enter the UPI ID that money should go to. You can also allow pay on delivery, or tap Connect Razorpay to take card and netbanking payments into your own Razorpay account.",
    nav: "settings",
    href: "/settings/payments",
    trail: ["Payments"],
    ownerOnly: true,
    keywords: "gpay phonepe paytm cod cash card razorpay",
  },
  {
    id: "receipt-setup",
    group: "setup",
    title: "Change what your bills show",
    steps: "Set the footer line and GSTIN, choose your printer paper width, and turn automatic printing on or off.",
    nav: "settings",
    href: "/settings/receipts",
    trail: ["Receipts"],
    ownerOnly: true,
    keywords: "gst print printer thermal 58mm 80mm a4",
  },
  {
    id: "order-alerts",
    group: "setup",
    title: "Get an alert on this phone for new orders",
    steps:
      "Turn alerts on for this device. On an iPhone, add AwaazOS to your Home Screen first. Turn on Voice alert to hear new orders spoken aloud while AwaazOS is open.",
    nav: "settings",
    href: "/settings/notifications",
    trail: ["Notifications"],
    keywords: "notification push sound locked voice speak announce",
  },
  {
    id: "voice-language",
    group: "setup",
    title: "Change the language of the mic",
    steps: "Choose the language your staff speak at the counter.",
    nav: "settings",
    href: "/settings/voice",
    trail: ["Counter & voice"],
    ownerOnly: true,
    keywords: "hindi english voice speech",
  },
  {
    id: "plan",
    group: "setup",
    title: "See your plan or subscribe",
    steps: "Shows the plan you are on, how much of it you have used, and how to subscribe when your trial ends.",
    nav: "settings",
    href: "/settings/billing",
    trail: ["Plan & billing"],
    keywords: "trial upgrade pay subscription locked price",
  },
];

export type ResolvedHelpTopic = HelpTopic & {
  href: string;
  /** Destination label, then the trail: `["Settings", "Payments"]`. */
  path: string[];
  /** On a phone the destination sits behind the "More" tab. */
  behindMore: boolean;
  /** This viewer can look but not change it. */
  ownerLocked: boolean;
};

function navItem(id: AppNavId): AppNavItem {
  return APP_NAV_ITEMS.find((item) => item.id === id)!;
}

/** The topics a staff member of this role can act on or look at, in display order. */
export function helpTopicsForRole(role: StaffRole, storePublished = false): ResolvedHelpTopic[] {
  const visible = new Set(appNavItemsForRole(role).map((item) => item.id));
  const moreIds = new Set(appTabBarForRole(role, storePublished).more.map((item) => item.id));
  return HELP_TOPICS.filter((topic) => visible.has(topic.nav)).map((topic) => {
    const item = navItem(topic.nav);
    return {
      ...topic,
      href: topic.href ?? item.href,
      path: [item.label, ...(topic.trail ?? [])],
      behindMore: moreIds.has(topic.nav),
      ownerLocked: Boolean(topic.ownerOnly) && role !== "OWNER",
    };
  });
}

/**
 * Case-insensitive search: every word typed must appear somewhere in the
 * topic's title, steps, path or keywords. An empty query matches everything.
 */
export function matchesHelpQuery(topic: ResolvedHelpTopic, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [topic.title, topic.steps, topic.path.join(" "), topic.keywords ?? ""].join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}
