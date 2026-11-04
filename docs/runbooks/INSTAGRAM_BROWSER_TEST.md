# Instagram browser test

Most buyers open a store from Instagram, inside its in-app browser. Automated tests can't reach that
browser or hand off to a real UPI app, so this is run by hand on real phones. Step 2 of the plan in
`docs/ICP.md`.

**Run it on:** one Android phone and one iPhone, each with Instagram and a UPI app installed.

**Use:** your own test store. Real orders appear on its board and in its figures. Pay ₹1 on an item
you can price that low, or cancel the order afterwards.

**Setup:** post the store link somewhere you can tap it inside Instagram: your bio, or a story's
Link sticker. Use the link from the setup card or the Instagram story button, then repeat with a
plain link. Don't open it from a browser.

## Steps

Record pass or fail for each phone. On a failure, note what was on screen.

| # | Do | Expect |
|---|---|---|
| 1 | Tap the link in Instagram | The store opens inside Instagram with photos and prices |
| 2 | Add items, open checkout, fill in the details | The keyboard doesn't hide the fields; the cart survives scrolling |
| 3 | Place a UPI order | The order page opens with the UPI payment option |
| 4 | Tap to pay by UPI | A UPI app opens with the store's name and the right amount. **The step most likely to break** |
| 5 | Pay, then return to Instagram | The order page is still there, not reloaded to an empty store |
| 6 | Tap "Payment done?" and submit | The claim saves. The screenshot picker opens, if this store has one |
| 7 | If the store has Razorpay, tap "Pay online" | Checkout opens, payment completes, and the page shows paid |
| 8 | Tick "Also send my order to the store on WhatsApp" | WhatsApp opens with the order typed in |
| 9 | Close Instagram, reopen the link | The store remembers the recent order |
| 10 | Tap "Check for update" on the order page | The page shows the seller's latest status |
| 11 | On `/admin/metrics`, read "Orders from Instagram" | The count went up by the orders you placed |

## If a step fails

Fix only what failed. If a step can't work inside Instagram at all, show an "Open in browser" hint at
that step and only there (`isInAppBrowser` in `lib/install-app.ts` already detects it). Don't add the
hint to pages that work.

Record the date, phones and results in `docs/ICP.md` under step 2.
