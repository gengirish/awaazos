# Demo-store pipeline (`/admin/demo-stores`)

What the outreach team works from. North-star metric: the share of built stores
claimed within 7 days. Rules live in `lib/demo-pipeline.ts` (pure), database side in
`lib/demo-pipeline-server.ts`, screens in `components/admin/pipeline/`.

## No cron

Nothing moves on a timer. A store's status, next follow-up and queue position are
worked out from its dates every time the page loads. So there is no schedule to
fail, Neon can sleep, and claiming a store stops its follow-ups because `isDemo`
flips.

## Statuses

| Status | When |
| --- | --- |
| `built` | Not sent, and no claim link made |
| `invite_sent` | Sent less than 2 days ago |
| `followup_1` | 2 days after sending. Due until a nudge is sent, then waits 3 days |
| `followup_2` | 3 days after the first nudge. Due until a nudge is sent, then waits 5 days |
| `expired` | 5 days after the second nudge |
| `claimed` | `Vendor.isDemo` is false |
| `archived` | Archived by hand, or stale: never sent, no real orders, 21 days old (or 21 days since a restore) |

Follow-ups wait for you: a due follow-up stays due until you send it, and nothing is
ever sent from our side. A claim link counts as sent, so a link from the internal API
starts the sequence too.

## Queue order

Highest score first, then newest. Snoozed and archived stores are left out, and so
are stores waiting on the seller.

| Points | Reason |
| --- | --- |
| +100 | Unclaimed, with a real order the seller hasn't been contacted about since |
| +60 | A follow-up is due |
| +40, less 1 a day (at least 1) | Built, not sent |
| +30 | Going quiet: claimed over 7 days ago, no drop this week, no order in 14 days, not nudged in the last 7 days |

Only real orders count: `isSample: false`, not cancelled.

## Sending

Send opens your own WhatsApp through a `wa.me` link and records the send. WhatsApp
doesn't tell us whether you tapped send there, so Undo is how you take it back.
**Already messaged them** (in the ⋯ menu) records a send without opening anything,
for sellers you reached before this page recorded sends.

The first invite carries the store link only. A claim link needs the seller's email,
because that email becomes their login, so it joins the message once an email is saved
on the card.

- A claim link is made when the message is opened. Only a hash of its token is stored,
  so a link can't be shown again later.
- Making a link also emails it to the seller, and voids their earlier link. The page
  reuses a link it made during the same visit.
- Undoing a send doesn't bring a voided link back.

## Templates

`outreachTemplate()` in `lib/outreach-message.ts`, edited per send in the box:
first invite, follow-up 1, follow-up 2, orders waiting, going quiet. Tokens are
`{firstName} {storeName} {storeUrl} {claimUrl} {area}`. The sender's first name comes
from their account. The seller's first name comes from the build form or the card;
without one the greeting is "Hi,".

## Hygiene

- **Possible duplicate:** same name in the same area (a missing area matches), or the
  same phone or Instagram handle. Choosing one archives the other as `duplicate`. Orders
  never move between stores, so a store with real orders can't be the one archived.
- **Looks like a test:** a name under 4 characters, or starting with test, asd, qwe or demo.
- **Stale:** see `archived` above. Restore starts its 21 days again.
- **Delete** is in the ⋯ menu, admins only. It is soft: `DemoPipeline.deletedAt` plus
  `Vendor.isActive = false`, so its public pages and claim links stop working. Nothing
  is removed and it can be undone. The internal API's `DELETE` still really deletes.

## Audit trail

Every action writes a `DemoAuditLog` row: `invite_sent`, `nudge_sent`, `snoozed`,
`archived`, `restored`, `contact_saved`, `undo`, next to the existing `create`,
`delete`, `handover` and `claim`. The payload holds what the action replaced, as dates
and enums and never contact details. Undo restores it, only for the store's newest
action and only for the person who took it.

## Permissions

ADMIN and SUPER_ADMIN see every store. SALES see only the stores they built and can't
delete. Anyone else gets 404.

## Shortcuts (Today view)

| Key | Action |
| --- | --- |
| `S` | Send |
| `Z` | Snooze 3 days |
| `A` | Archive |
| `J` / `K` | Skip / Back |
| `U` | Undo, while the toast shows (6 seconds) |
| `Esc` | Leave the message box |

Shortcuts are off while you type in a field or a dialog is open.
