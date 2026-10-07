# AwaazOS — Agent Orientation

The agent guide for this repo is [`CLAUDE.md`](./CLAUDE.md). It covers commands, deploy topology,
the voice pipeline, money, tenant isolation, the PII boundary and API conventions. Read it first;
this file is only a pointer for tools that look for `AGENTS.md`.

Also read before touching the matching area:

- `.cursor/rules/*.mdc` — enforced conventions (money, tenant isolation, security, locale, voice,
  API routes, auth/RBAC, design system, accessibility).
- `.cursor/skills/awaazos-claude-pipeline/` and `.cursor/skills/awaazos-testing/` — project skills.
- `ARCHITECTURE.md` for diagrams and the data model; `TODO.md` for open items.

Essentials that are easy to get wrong:

- **Stack is locked:** Auth.js v5 + Prisma + Neon. Don't install `@clerk/nextjs`,
  `@supabase/supabase-js` or `svix`.
- Schema changes go through `npx prisma db push`; there are no migrations and no seed script.
- Never run `npm run e2e` against the production database (see CLAUDE.md).
- `docs/archive/` is frozen history, not a spec.
