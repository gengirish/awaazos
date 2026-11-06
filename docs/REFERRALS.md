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
| Live subscription (including one scheduled for a trial's end) | Banked as `EARNED` |
| Grandfathered FREE store (`trialEndsAt` null) | Banked as `EARNED` |

Banked months are redeemed in `POST /api/razorpay/create-subscription`: they move `trialEndsAt`
forward first, and the route's existing "first charge at the trial's end" logic turns that into
Razorpay `start_at`. A grandfathered FREE store gets a trial end for the first time this way, so if
it later cancels it locks instead of going back to FREE.

## Where it is advertised

Settings → Refer a seller, Help, and two prompts: a banner on the orders board (last in the one banner
slot; published store, no invite yet) and a card on Plan & billing. Both are for an OWNER whose reward
would apply at once (`canPromoteReferrals`): on the trial or locked, with no live subscription. A paying
store isn't prompted, because its months stay banked until it next subscribes (see below).

## Not built

- Credit against a live paid subscription. It needs a pause of one billing cycle on Razorpay, and
  pause/resume on UPI AutoPay mandates has to be checked before relying on it. Until then those
  months stay banked and show in Settings → Refer a seller.
- A partner tier with cash payouts for people who bring many stores (society admins, bloggers).
  That is where TDS and GST handling would come in.
