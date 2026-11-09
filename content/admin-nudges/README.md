# Seller nudge messages

The "Nudge" button in the seller heartbeat on /admin/metrics opens WhatsApp with one of these
messages filled in. The admin can still edit it before sending, and nothing is sent until they tap
send in WhatsApp.

Edit the text freely. A change needs a commit and deploy like any other file, but no code.

| File | Used for |
|---|---|
| `at-risk.txt` | At risk: no paid bill for 7+ days, or this week's bills halved |
| `never-paid.txt` | At risk and the store has never had a paid bill |
| `watch.txt` | Watch: 3 to 6 days since the last paid bill |
| `new.txt` | New: the store is under 14 days old |
| `healthy.txt` | Healthy: paid bill in the last 2 days |

Variables, written with braces:

- `{firstName}`: the owner's first name. When unknown it disappears with the space before it, so
  "Hi {firstName}," becomes "Hi,".
- `{senderName}`: the first name of the admin sending it.
- `{storeName}`: the store's name.
- `{storeUrl}`: the store's public link.
- `{daysIdle}`: days since the last paid bill, as a number (0 = today).

A misspelt variable stays in the message as typed, so you will see it before sending.
