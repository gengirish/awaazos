# Branch Protection (main)

Apply these settings in GitHub repository settings for `main`.

## Required status checks

Require these checks before merge:

- `Lint + Type + Unit + Build`
- `E2E (Playwright)` — switched off in `ci.yml` (`if: false`, 2026-10-13). GitHub counts a skipped
  job as passing a required check, so while it is off this check gates nothing; run the suite
  locally before merging (see `CLAUDE.md`).
- `Secret scan + npm audit`

## Pull request rules

- Require a pull request before merging.
- Require at least 1 approving review.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merging.

## Merge controls

- Disallow force pushes to `main`.
- Disallow branch deletion of `main`.
- Require linear history (optional but recommended).
- Include administrators in restrictions.

## Deployment safety

- Use Vercel production deployment protection (if available) to require green CI.
- Keep Fly.io deploys tied to release commits only (no ad-hoc mutable releases).

