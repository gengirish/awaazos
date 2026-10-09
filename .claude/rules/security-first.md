---
description: Secure defaults, secret hygiene, PII boundaries
---

<!-- Generated from .cursor/rules/security-first.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# Security First — AwaazOS

## Secrets

- NEVER hardcode API keys, DB URLs, or tokens.
- All secrets via `process.env.*`, declared in the zod schema in `lib/env.ts`.
  Only `AUTH_SECRET` and `DATABASE_URL` are required at boot; integration keys
  are optional at boot and asserted lazily with `requireEnv(key)`.
- `.env.local` is gitignored. `.env.local.example` has placeholders only.
- If a secret leaks (in chat, in commit, in screenshot): rotate immediately at provider.

## PII boundaries

- Customer `phone`, `name`, UPI `utr` ref: stay in DB. NEVER sent to:
  - Anthropic (Claude prompts) — only `menu` + `transcript` go
  - STT providers (Sarvam, OpenAI, Groq, Whisper) — only audio bytes + language code
  - LLM logs (`VoiceParseLog`) — only `transcript`, `lang`, model metadata
  - Console / Sentry / OTel — scrub before logging
- Audio bytes: never stored. Streamed to the STT provider and discarded.

## Auth

- Validate authn + authz on every route. No exceptions.
- Reject cross-tenant requests with 404 (not 403) — don't leak existence.
- Webhooks: HMAC signature verification BEFORE any DB read or write.

## Razorpay webhook

Use `verifyRazorpaySignature(rawBody, sig)` from `lib/razorpay.ts`. Its core:

```ts
const expectedHex = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
const sigBuf = Buffer.from(signature, "hex");
const expBuf = Buffer.from(expectedHex, "hex");
if (sigBuf.length !== expBuf.length) return false;
return crypto.timingSafeEqual(sigBuf, expBuf);   // never `sig !== expected`
```

In the route: `if (!verifyRazorpaySignature(rawBody, sig)) return NextResponse.json({}, { status: 401 });`
— read `rawBody` with `req.text()` and verify before `JSON.parse` or any DB access.

## Logging

- New code should use `logger` from `lib/logger.ts` (pino, JSON output, with
  PII redaction paths for phone/email/password/cookie/authorization fields).
- The hot routes (`/api/ai/transcribe`, `/api/ai/parse-order`,
  `/api/transactions`) still log with `console.log(JSON.stringify({...}))` /
  `console.error`. Those lines bypass the redactor, so pass them explicit,
  PII-free fields only — never a request body or a raw error object.
- NEVER log:
  - Request bodies for `/api/auth/*`
  - Anything containing `Authorization`, `Cookie`, `passwordHash`
  - Customer phone/name/UTR
  - Audio bytes / file uploads

## Dependencies

- No `eval`, `Function()`, `dangerouslySetInnerHTML` without explicit review
- `next-auth` is pinned exactly (`5.0.0-beta.32`) — keep it exact; betas break between builds.
- `@anthropic-ai/sdk` is `^0.132.1`. On a 0.x version the caret allows patch
  releases only (`<0.133.0`), so minor bumps are already manual. Bump it
  deliberately, re-run the golden parse-order and parse-drop suites, and keep
  `lib/__tests__/anthropic-request-shape.test.ts` (wire-body fixture) green.
- Run `npm audit` weekly; fix HIGH/CRITICAL before deploy

## DPDP Act readiness

- Data export (User + all their Vendors' Transactions): **not implemented.**
  `/api/me` has no `GET`; the only bulk export is the STARTER-gated CSV at
  `/api/transactions/export`.
- Deletion: `DELETE /api/me` deletes the User (cascading their `StaffMember`
  rows). Any vendor where they were the only active OWNER is deleted too, with
  all its data. Vendors that have another OWNER are kept. There is no
  "retain but scrub contact details" path.
