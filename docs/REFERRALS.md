# Referrals: "Refer a seller"

Store owners invite other home sellers. The reward is free Starter time, never cash.
Code: `lib/referral.ts` (rules, pure), `lib/referral-server.ts` (database).

## Why free months, not commission

A cash commission brings TDS on commission (section 194H), GST questions for the person paid,
payout rails and KYC. At ₹649 a month none of that pays for itself. A free month costs only
revenue we would not have had, and it is paid only after the referred store has paid us, so a
fake sign-up is worth nothing to anyone.

## Rules

| Event | Referred store | Referrer |
| --- | --- | --- |
| Signs up with `?ref=<slug>` | 60-day trial instead of 30 | nothing yet |
| First subscription charge (> ₹0) | nothing more | 1 free month, 2 if the store paid yearly |

- Cap: 12 reward months per referrer in any rolling 365 days. Past it nothing is recorded.
- One reward per referred store, ever (`ReferralReward.referredVendorId` is unique).
- Ignored silently at sign-up: unknown slug, inactive store, demo store, and a referrer whose email
  or phone matches the new account. Demo stores never earn. A store claimed from a demo is never
  attributed (the claim path does not set `referredByVendorId`).
- The code is the slug. Changing the store link retires links shared under the old one.

## Redemption without timers

| Referrer when the reward is earned | What happens |
| --- | --- |
| On the trial or locked, no live subscription | `trialEndsAt` moves forward 30 days per month, from the later of now and the current trial end |
| Live subscription (including one scheduled for a trial's end) | Banked as `EARNED`, then refunded from its next charge (below) |
| Grandfathered FREE store (`trialEndsAt` null) | Banked as `EARNED` |

Banked months are redeemed in `POST /api/razorpay/create-subscription`: they move `trialEndsAt`
forward first, and the route's existing "first charge at the trial's end" logic turns that into
Razorpay `start_at`. A grandfathered FREE store gets a trial end for the first time this way, so if
it later cancels it locks instead of going back to FREE.

## Free months for a paying store: a refund of its next charge

Razorpay can't skip a cycle of a UPI AutoPay subscription: UPI subscriptions can't be updated, an
offer can only be linked through an update and must leave more than ₹1 to charge, and pause is
"now" only (resuming on time would need a timer) and can be undone from the customer's UPI app.
So the charge goes through and the month is paid back:

1. `subscription.charged` for a store with banked months (`recordSubscriptionEvent`'s transaction):
   `creditForCharge` takes one month for a monthly charge and refunds all of it, or up to 12 months
   for a yearly charge at 1/12 of it each. Rewards are used oldest first (`monthsUsed`; a reward is
   `REDEEMED` via `charge_refund` once used up), and a `ReferralCredit` (PENDING) is recorded,
   unique on the payment and on the event.
2. After commit the webhook calls `settleReferralCredit`: row lock, look for a refund on the payment
   with `notes.referralCreditId`, else create one (normal speed, platform account), then REFUNDED.
3. A refusal (often a low Razorpay balance) is kept in `lastError` and listed on `/admin/referrals`
   with **Retry refund**. The webhook still answers 200: a run of 500s would make Razorpay retry or
   disable the endpoint and stop every subscription update.

Costs: Razorpay keeps its fee on a refunded payment (about ₹15 on Starter), each refund needs a GST
credit note, and the seller sees the debit and then the refund 5 to 7 days later. A charge refunded
in full is not money in, so it earns nothing for that store's own referrer; `/admin/earnings` nets
refunds out of the sales share.

## Where it is advertised

Settings → Refer a seller, Help, and two prompts: a banner on the orders board (last in the one banner
slot; published store, no invite yet) and a card on Plan & billing. Both are for an OWNER who would
get the reward soon (`canPromoteReferrals`): as free time on the trial or when locked, or as a refund
with a live subscription (the wording says so). A store with no charge coming (grandfathered FREE, or
a plan cancelled at period end) isn't prompted: its months only wait for its next subscribe.

## Not built

- A partner tier with cash payouts for people who bring many stores (society admins, bloggers).
  That is where TDS and GST handling would come in.
