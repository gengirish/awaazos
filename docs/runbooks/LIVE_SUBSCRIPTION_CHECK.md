# Live subscription check

Run one real subscription on a real store before the first trial ends (9 Nov 2026), so a seller
isn't the first person to find a problem. This moves real money: ₹299 + 18% GST, plus Razorpay's
small refundable authorisation if the mandate is taken during a trial.

**Use:** your own test store, signed in as its OWNER, and your own UPI or card.

**To see the charge today:** use a store whose trial is already over. A subscription taken during a
trial only charges when the trial ends. To end a trial on purpose, choose today as the "free until"
day on `/admin/vendors`; the store locks at midnight IST.

## Steps

| # | Do | Expect |
|---|---|---|
| 1 | Open Settings → Billing, choose monthly, pay in Razorpay Checkout | Checkout opens with ₹352.82, the page returns to Billing and shows the plan as active |
| 2 | Open the store as a buyer and place an order | The order goes through (no "can't take online orders") |
| 3 | Razorpay Dashboard → Subscriptions | The subscription is active, with one successful payment |
| 4 | Razorpay Dashboard → Webhooks | `subscription.charged` delivered with a 200 |
| 5 | `/admin/vendors` | The store shows STARTER with an end date about a month away |
| 6 | Settings → Billing → cancel at the end of the cycle | Access stays until the end date. Do this last, or keep the plan |

Also take a mandate on a store still in its trial: Checkout should show only the authorisation
amount, the billing page should show the first charge on the day the trial ends, and that store
should get no trial reminder emails after that.

## Trial alerts

| # | Do | Expect |
|---|---|---|
| 1 | Set `CRON_SECRET` on Vercel (Production), then redeploy | Vercel lists `/api/cron/trial-reminders` under Settings → Cron Jobs |
| 2 | Run the job from that page | Logs show `trial_reminders.done` with counts |
| 3 | Use free access on `/admin/vendors` to end a test store's trial in 3 days, then run the job | Its owner gets "Your AwaazOS free trial ends in 3 days", once. A second run sends nothing |
| 4 | On a locked test store, place an order as a buyer | The buyer sees "can't take online orders". The owner gets a push and an email, once a day however many buyers try |

## If something fails

Stop and extend the affected stores with free access on `/admin/vendors` before their trials end,
then fix it. Record the date and result here.
