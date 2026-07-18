# Anon Lens — Capability Map (Frontend Rebuild Program, Wave 2)

Reproduce the macro list:
`grep -c 'registerLensAction("anon"' server/domains/anon.js` → 14

## Reference apps

- **Signal** — the E2E messaging shape this lens genuinely implements: X25519
  ECDH + AES-256-GCM sealed-per-recipient envelopes, safety-number
  verification, disappearing messages, sealed sender.
- **ARX / a k-anonymity + differential-privacy engineering tool** — real
  generalization-hierarchy k-anonymity, prosecutor/journalist/marketer
  re-identification risk scoring, and Laplace-mechanism differential privacy
  with epsilon-budget tracking. This is a legitimate privacy-engineering
  domain, not a euphemism for anything else.

## Audit finding: the messaging + Tor-status surfaces were already real; the privacy-compute surface was reachable in name only

Before this pass:

- `AnonMessenger` was already a complete, real implementation of every one
  of the 11 identity/messaging macros (identity, rotateIdentity,
  safetyNumber, verifyPeer, startConversation, listConversations,
  sendMessage, readConversation, setDisappearing, sweepEphemeral,
  directory) — genuine X25519 keypairs, genuine AES-256-GCM sealed
  envelopes verified server-side (`server/domains/anon.js`), safety-number
  compare-and-verify flow, disappearing-message timers, sealed sender. Left
  untouched.
- `TorNetworkStatus` pulls real live data from `onionoo.torproject.org`
  (relay/bridge counts, flag distribution). Left untouched.
- The three privacy-compute macros (`anonymize`, `privacyRisk`,
  `differentialPrivacy`) are real, substantive implementations (generalization
  search for k-anonymity, three attack-model risk scores, Laplace-mechanism
  noise with epsilon-budget tracking) — but the page fed them from a generic
  per-domain artifact store (`useLensData('anon', 'privacy-set', {seed: []})`)
  that nothing in the UI ever populated. The three buttons were real,
  wired, well-designed result cards — pointed at a permanently-empty target.
  Every click landed on the honest "no artifact" empty state; the macros
  themselves were never actually reachable in practice.

## What this rebuild changed

- `concord-frontend/app/lenses/anon/page.tsx` — dropped the generic
  auto-discovered action bar (redundant given the three purpose-built
  privacy-compute buttons already existed) and replaced the dead artifact
  dependency with a real, small dataset editor: an add-row form
  (age/zipcode/condition — the canonical HIPAA-Safe-Harbor-style
  age/zip/diagnosis quasi-identifier shape used throughout k-anonymity
  literature), a "load example dataset" button seeding a clearly-labeled
  ten-row teaching dataset (not live user data, not presented as such), and
  an epsilon control for the differential-privacy action. All three actions
  now call `lensRun('anon', action, input)` directly, so the posted records
  become the macro's real input with no generic-artifact indirection.
- Fixed the differential-privacy epsilon control being entirely absent
  before (the macro's `params.epsilon` always defaulted to 1.0 with no way
  for a user to change it).

## Note on cross-run epsilon-budget tracking — ~~open~~ CLOSED (2026-07-16, `346320b2`)

`differentialPrivacy`'s `budgetTracking.cumulative` field previously only
reflected the current call, since each invocation ran against an ephemeral
virtual artifact (`/api/lens/run`'s `{id: null, data: rest}`) with no
persistence — there was no cross-session accumulation to show. Closed with
a real `budgets` per-user state bucket (same `Map`-per-user idiom as
`identities`/`conversations`/`userConvs`); `differentialPrivacy` now spends
its real per-call epsilon (the pre-existing epsilon math is unchanged)
against the caller's persistent ledger, and only from the success path —
a failed/short-circuited call is never falsely accumulated. New
`privacyBudgetStatus` (read-only status) and `privacyBudgetReset`
(caller-scoped mutation) macros. The accumulation window is
forever-until-explicit-reset by design: this lens has no product-defined
epoch to anchor an arbitrary rolling-decay length to, and inventing one
would itself be fabricated precision. `PrivacyBudgetPanel.tsx` surfaces
real cumulative spend, remaining budget, and call history, with a
two-step confirm before the destructive reset action.

## Verification

- `npx eslint app/lenses/anon/page.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `anon` still `WIRED`; total unchanged at 258 WIRED / 2 NO-BACKEND-CALL.
- `node scripts/grade-ux-polish.mjs --honest` — `anon`: `tier: "polished"`, `isGenericScaffold: false`.
- No existing anon-lens test file (confirmed by search) — nothing to update.
