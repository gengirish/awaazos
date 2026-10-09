---
description: AwaazOS visual design system — saffron-orange POS, mobile-first
paths: ["**/*.tsx","**/*.css"]
---

<!-- Generated from .cursor/rules/design-system.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# AwaazOS Design System

## Brand

- **Tagline:** "Bol. Bill. Becho." (always Latin script in UI; आवाज़ in logo only)
- **Primary:** saffron orange `#FF6B00` → CSS var `--primary`
- **Accent:** deep charcoal `#1A1A1A` (text)
- **Surface:** white `#FFFFFF` / Slate-50 `#F8FAFC`
- **Success:** green `#16A34A` (paid status)
- **Warning:** amber `#F59E0B` (pending payment)
- **Danger:** red `#DC2626` (failed)

## Vendor theme override

`VendorSettings.theme` ∈ `orange | green | blue | purple` swaps `--primary`
via CSS variables — never hardcode hex in components.

## Typography

- **Headings:** Baloo 2 (Google Fonts) — has Devanagari for आवाज़ logo
- **Body:** Nunito (Google Fonts)
- **Data / bills:** Tailwind's default `font-mono` stack (system monospace).
  JetBrains Mono is **not** loaded.
- Baloo 2 and Nunito load via `next/font/google` in `app/layout.tsx`
  (`--font-baloo`, `--font-nunito`), mapped to `font-display` / `font-body` /
  `font-sans` in the `@theme` block of `app/globals.css` (Tailwind 4, CSS-first config)

## Icons

- **Lucide React only.**
- Emojis allowed ONLY in user-content fields (menu item `emoji`). Never in receipt text:
  some WhatsApp clients render them as "�".
- Never use emojis as UI affordances.

## Mobile-first breakpoints

- POS: design at 390 px (iPhone 14 budget Android width). Test at 360 px / 414 px / 768 px.
- Marketing: design at 390 px → scale up to 1440 px max content width.

## shadcn/ui usage

- Init with `slate` base, `default` style, CSS variables.
- Customize via CSS vars in `globals.css` — never modify primitives in `components/ui/`.
- Always pull components via `npx shadcn@latest add <name>` (don't hand-write).

## Spacing scale

Use Tailwind defaults. POS-specific:
- Cart row vertical rhythm: `py-3` (12 px) — fits 6 items above the fold on 390×844
- Section gap on dashboard: `gap-6` (24 px)

## Motion

- Respect `prefers-reduced-motion` — disable mic pulse, slide-up sheets become fade
- Transition durations: 150–300 ms
- Mic listening: Tailwind `motion-safe:animate-pulse` on `VoiceOrderButton`
  (there is no custom `mic-pulse` keyframe)

## Don't

- No inline styles (use Tailwind utilities)
- No CSS-in-JS libraries
- No `!important`
- No hardcoded colors — always `bg-primary`, `text-foreground`, etc.
