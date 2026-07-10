# Bounties Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Reproduce the macro list:
`grep -c 'registerLensAction("bounties"' server/domains/bounties.js` → 10

## Reference apps

**HackerOne/Bugcrowd** (security angle) and **Gitcoin** (generic-bounty-board
angle) — the code's own header comment states "Gitcoin / HackerOne 2026-
parity."

## Audit finding: real bounty-board loop, one fabricated claim (fixed)

All 10 macros (`create`, `list`, `get`, `submit`, `review`,
`release-milestone`, `dispute-open`, `dispute-resolve`, `leaderboard`,
`my-activity`) are real: an in-memory (persisted) state machine with fail-
closed numeric guards on reward fields (capped at `REWARD_MAX = 1e6`), real
payout bookkeeping, and a genuine create → submit → review/accept →
milestone payout → dispute → arbitration loop. `node scripts/lens-unsurfaced.mjs
--lens bounties` → `bounties: 0/10 macros never referenced in the frontend`.

`GhsaAdvisories.tsx` fetches directly from the **real** GitHub Security
Advisories API (`api.github.com/advisories`) — genuine CVE/CVSS/package
data, correctly labeled "live." But it rendered a **fabricated claim**: every
single advisory row carried a `<Coins>` icon captioned "Bounty-eligible via
vendor program" (`GhsaAdvisories.tsx:83`, pre-fix) regardless of whether that
CVE's vendor actually runs a paid bounty program — GHSA's API returns no
such field. This is an invented claim glued onto real data, on a page
literally themed around bounty legitimacy — a direct honesty-invariant
violation.

Secondary finding (not a fabrication, but a real gap): the GHSA advisories
panel lived only under the "Autofix staking" tab, structurally disconnected
from the actual Bounty board macros — no way to turn a real CVE into a real
Concord bounty despite both features sharing the page and the "bounty"
framing.

## What this rebuild changed

`components/bounties/GhsaAdvisories.tsx`:
- **Removed** the fabricated "Bounty-eligible via vendor program" badge
  entirely — no such data exists, so no such claim is made.
- **Added** a real "Bounty this" action per advisory, wired through a new
  `onConvertToBounty` prop, that builds an honest draft (title/description/
  category/tags derived directly from the real GHSA fields — CVE id,
  summary, affected packages, severity, CVSS score, advisory URL) with no
  invented eligibility claim.

`components/bounties/CreateBountyForm.tsx`:
- Added optional `prefill`/`onConsumePrefill` props so an external draft
  (from the new GHSA action) opens the form pre-filled instead of requiring
  the user to retype the CVE details by hand. No default reward is
  fabricated — the user still sets a real `rewardCc` before posting,
  exactly as with a manually-authored bounty.

`app/lenses/bounties/page.tsx`:
- Added `bountyPrefill` state and a `convertAdvisoryToBounty` callback that
  switches to the "Bounty board" tab and hands the draft to
  `CreateBountyForm`, closing the disconnect between the two real surfaces
  that share this lens.

## Verification

- `npx eslint app/lenses/bounties/page.tsx components/bounties/GhsaAdvisories.tsx components/bounties/CreateBountyForm.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `bounties` stays `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `bounties`: `tier: "polished"`, `isGenericScaffold: false`.
