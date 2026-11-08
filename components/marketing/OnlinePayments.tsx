import { CheckCircle2, CreditCard, Landmark, UserPlus, Wallet } from "lucide-react";

// The one payment story of the landing page (the feature grid doesn't repeat it).
// Only what ships (lib/razorpay-oauth.ts, Settings → Payments). The money settles
// into the seller's own Razorpay account: never say we collect it or pay it out.
const points = [
  {
    icon: CreditCard,
    title: "UPI, card or netbanking",
    description: "Right on your store page. The order turns paid and confirmed on your board: no screenshots to check.",
  },
  {
    icon: Landmark,
    title: "The money is yours",
    description: "It goes straight into your own Razorpay account. AwaazOS never touches it. Razorpay's own fees apply.",
  },
  {
    icon: UserPlus,
    title: "No Razorpay account yet?",
    description:
      "Tap Connect Razorpay and create one on the next screen. Razorpay checks your KYC (PAN, bank account). No API keys to copy.",
  },
  {
    icon: Wallet,
    title: "Prefer your own UPI ID or cash?",
    description: "That works too. Buyers pay you directly or on delivery, and you mark the order paid.",
  },
] as const;

// Illustration only (aria-hidden): one order on the seller's board after an online payment.
function PaidOrderMockup() {
  return (
    <div
      className="mx-auto w-full max-w-sm rounded-2xl border border-border/80 bg-background p-5 shadow-lg"
      aria-hidden="true"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-base font-bold text-awaaz-charcoal">New order</p>
          <p className="mt-0.5 text-sm text-muted-foreground">2 × Cinnamon rolls, box of 4</p>
        </div>
        <p className="font-mono text-base font-semibold text-awaaz-charcoal">₹560</p>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/30 px-3 py-2.5 text-sm font-semibold text-success">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        Paid online · Confirmed
      </div>
      <p className="mt-3 text-center text-sm text-muted-foreground">Nothing for you to tap.</p>
    </div>
  );
}

export function OnlinePayments() {
  return (
    <section
      id="online-payments"
      aria-labelledby="online-payments-heading"
      className="bg-awaaz-cream/60 px-4 py-16 sm:px-6 sm:py-20"
    >
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[3fr_2fr] lg:items-center">
        <div>
          <h2
            id="online-payments-heading"
            className="font-display text-3xl font-bold text-balance text-awaaz-charcoal sm:text-4xl"
          >
            Buyers pay online. Orders mark themselves paid.
          </h2>
          <p className="mt-3 max-w-2xl text-awaaz-charcoal/85">
            Connect Razorpay in a few taps from Settings. The money goes straight into your own account.
          </p>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2">
            {points.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.title} className="flex gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-awaaz-orange/10 text-awaaz-orange">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-awaaz-charcoal">{p.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-awaaz-charcoal/80">{p.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <PaidOrderMockup />
      </div>
    </section>
  );
}
