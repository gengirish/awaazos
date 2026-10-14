---
description: AwaazOS visual design system — saffron-orange POS, mobile-first
paths: ["**/*.tsx","**/*.css"]
---

<!-- Generated from .cursor/rules/design-system.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# AwaazOS Design System

## Brand

- **Tagline:** "Bol. Bill. Becho." (always Latin script in UI; आवाज़ in logo only)
- **Brand colour:** saffron orange `#FF6B00` — the logo and brand artwork only
  (`brand-saffron`). White text on it is 2.9:1, so it is never a UI fill.
- **Primary (UI fills, links, focus ring):** `--primary: 25 100% 37%` (`#BD4F00`),
  the same hue darkened until white text passes AA (4.93:1). `--ring` and
  `--awaaz-orange` carry the same value.
- **Accent:** deep charcoal `#1A1A1A` (text)
- **Surface:** white `#FFFFFF` / Slate-50 `#F8FAFC`
- **Success:** `--success: 142 72% 29%` → `bg-success` / `text-success` (paid status)
- **Warning:** `--warning: 35 92% 33%` → `bg-warning` / `text-warning` (pending payment)
- **Danger:** `--destructive` → `bg-destructive` / `text-destructive` (failed)

Status tokens come with `-foreground` partners (`text-success-foreground` on
`bg-success`) and `.dark` values. Both pass 4.5:1 as text on white and as a fill
under their foreground (success 5.07:1, warning 4.95:1). Use them for new work
instead of raw palette classes (`text-green-700`, `bg-amber-600`); existing
screens still carry raw classes and move over as they are touched.

## Vendor theme override

`VendorSettings.theme` swaps `--primary` and `--ring` through a `[data-theme]`
block in `app/globals.css` — never hardcode hex in components. The values with
a block are `green | amber | red | blue | purple`; `orange` (the column default)
and anything unknown stay on the default primary. Only the storefront pages
(`/s/[slug]` and below, `BRAND_THEMES`) apply it, and no API route or Settings
screen writes the column yet.

Every theme primary must keep white text at 4.5:1 or better:

| Theme | `--primary` | White text |
|---|---|---|
| orange (default) | `25 100% 37%` | 4.93:1 |
| green | `142 72% 29%` | 5.07:1 |
| amber | `32 95% 33%` | 5.21:1 |
| red | `0 72% 51%` | 4.80:1 |
| blue | `221 83% 53%` | 5.20:1 |
| purple | `262 83% 58%` | 5.67:1 |

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
- Customize colours and radius via CSS vars in `globals.css`.
- Primitives in `components/ui/` may be edited for **system-wide touch /
  accessibility defaults** only (sizes, hit areas, motion, safe areas). A
  one-screen tweak belongs at the call site via `className`. Re-running
  `npx shadcn@latest add` over an edited primitive drops those edits — diff first.
- Pull new components via `npx shadcn@latest add <name>` (don't hand-write).
  The exceptions are `responsive-dialog.tsx`, `confirm-dialog.tsx`, `empty-state.tsx`
  and `notice.tsx`, which are ours.

## Touch defaults built into the primitives

- **44 px on coarse pointers, by default.** `Button` (`default`, `sm`, `icon`),
  `Input`, `SelectTrigger` and `SelectItem` carry `touch-target` /
  `touch-target-square` (defined in `app/globals.css`, `@layer components`,
  `@media (pointer: coarse)`). Mouse users keep the 36/40 px desktop density.
  Don't add `min-h-11` to a new `<Button>` to reach 44 px; it already does.
- The floor is in the components layer on purpose: any utility a call site
  passes (`h-12`, `min-h-14`) still wins. Don't replace it with
  `pointer-coarse:min-h-11` in the class list — that variant is emitted after
  plain utilities and would shrink a `min-h-12` call site on phones.
- A hand-rolled `<button>` / `<a>` gets no floor: give it `min-h-11` (and
  `min-w-11` if icon-only) or the `touch-target` class.
- Dialog / Sheet close buttons are a 44×44 hit area around the 16 px icon.

## Modals

- Use `ResponsiveDialog` (`components/ui/responsive-dialog.tsx`) for any modal a
  vendor or buyer meets on a phone: bottom sheet below `md`, centred dialog from
  `md`. Header and Footer stay put, `ResponsiveDialogBody` scrolls.
- The sheet/dialog switch is CSS breakpoints on one element. Never pick the
  layout from `useIsDesktop()` / `matchMedia`: swapping component trees remounts
  the content and loses form state. `hooks/useMediaQuery.ts` is for behaviour
  (e.g. desktop-only auto-print).
- Heights in `dvh`, never `vh` (`max-h-[92dvh]`): `vh` ignores mobile browser
  toolbars and hides the bottom of the modal.

## Empty states and inline notices

- "Nothing here yet" is `EmptyState` (`components/ui/empty-state.tsx`): the
  dashed box with an optional icon, title, description and one action. Never
  fake rows or placeholder numbers. Pass `role="status"` only when it appears
  in response to an action (a search with no matches).
- A boxed message about a blocked or failed action is `Notice`
  (`components/ui/notice.tsx`, `tone="warning" | "danger"`), next to the control
  it is about, with `role="alert"` when it appears in response to an action.
  A one-line field error stays plain `text-destructive` text under its input.

## Safe areas

`app/layout.tsx` sets `viewportFit: "cover"`, so `env(safe-area-inset-*)` is
live. `body` pads left/right/bottom itself, which covers in-flow and `sticky`
content. Anything `fixed` is positioned against the viewport and must add its
own inset: `pb-[max(0.75rem,env(safe-area-inset-bottom))]` on bottom bars,
`pl-[max(1rem,env(safe-area-inset-left))]` / `pr-[…]` on full-width ones.

## Spacing scale

Use Tailwind defaults. POS-specific:
- Cart row vertical rhythm: `py-3` (12 px) — fits 6 items above the fold on 390×844
- Section gap on dashboard: `gap-6` (24 px)

## Motion

- Respect `prefers-reduced-motion` — disable mic pulse, slide-up sheets become fade
  (`Sheet` and `ResponsiveDialog` already do: slides are `motion-safe:` only)
- Transition durations: 150–300 ms
- Mic listening: Tailwind `motion-safe:animate-pulse` on `VoiceOrderButton`
  (there is no custom `mic-pulse` keyframe)

## Don't

- No inline styles (use Tailwind utilities)
- No CSS-in-JS libraries
- No `!important`
- No hardcoded colors — always `bg-primary`, `text-foreground`, etc.
