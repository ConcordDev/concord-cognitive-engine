# Insurance Lens — Capability Map (Frontend Rebuild Program)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("insurance"' server/domains/insurance.js
```
→ **71** macros in `server/domains/insurance.js` (1,884 lines), covering two
real surfaces sharing one domain string:
- the `/lenses/insurance` real-world agency-management workbench
  (policy/claim CRUD, coverage-gap/loss-ratio/renewal analytics, an Applied
  Epic / EZLynx-parity backlog — carriers, renewal pipeline, FNOL, statement
  reconciliation, ACORD certificates, book-of-business, e-sign/binder), and
- the `/lenses/death-insurance` sparks-only mutual-aid inheritance pact
  substrate (`pact-*`, 11 macros) — **out of scope for this pass** per the
  assignment brief, but composed into the `/lenses/insurance` page via
  `MutualAidPactsPanel.tsx` (see "Domain-string collision" below).

Registered via `registerInsuranceActions(register)` at `server/server.js:25867-25868`.

## The `insurance` vs inline `write_contract`/`revoke`/`list_for_user` question

`server/server.js:77068-77113` separately registers **3 more macros** on the
same `"insurance"` domain string: `write_contract`, `revoke`, `list_for_user`
— a second, SQLite-backed (`insurance_contracts` table, migration
`163_economy_primitives.js`), sparks-denominated "death-lottery insurance"
system with the *same* feature (insured pays a premium; a named beneficiary
gets a sparks payout if the insured "falls in Concordia"; suicide-pact
blocked) as the `pact-write`/`pact-list`/`pact-revoke` macros in
`domains/insurance.js`.

**Verified: this is dead, orphaned, duplicate backend, not a live collision.**
- The two macro sets don't collide by name (`write_contract` vs `pact-write`,
  `revoke` vs `pact-revoke`, `list_for_user` vs `pact-list`), so both register
  successfully — no macro silently overwrites the other.
- `grep -rn "write_contract\|insurance_contracts" concord-frontend/` (excluding
  the generated `coverage/` reports) returns **zero** frontend call sites.
  Only `server/server.js` (the registration itself) and the migration file
  reference `write_contract` / `insurance_contracts` at all.
- `server/tests/insurance-death-pact-macros.test.js` and
  `docs/CLAUDE.md`'s own file-header comment in `domains/insurance.js`
  confirm the **pact-* macros are the one true death-insurance backend** the
  `/lenses/death-insurance` UI (`PactWriter.tsx`, `PactCard.tsx`) and the
  `/lenses/insurance` UI (`MutualAidPactsPanel.tsx`) both call.
- The `write_contract`/`revoke`/`list_for_user` trio and its
  `insurance_contracts` table are reachable only via direct macro/API call —
  no lens, no test beyond registration, no other backend module reads
  `insurance_contracts`. This reads as an earlier, superseded implementation
  of the same feature (single-beneficiary, no renewal/handshake/premium
  schedule) left in place after the richer `pact-*` system replaced it,
  never deleted.

**Left alone, flagged for the maintainer to decide.** Removing dead backend
code was not requested and risks nothing this pass touches, but is worth a
deliberate cleanup: `server/server.js:77068-77113` (the 3 macros) +
migration `163_economy_primitives.js`'s `insurance_contracts` table are
candidates for retirement once confirmed there's no still-open historical
data anyone cares about preserving.

## Frontend surface (14 files, 3,535 LOC per `grade-ux-polish.mjs`)

`concord-frontend/app/lenses/insurance/page.tsx` +
`concord-frontend/components/insurance/{AmsWorkbench,ClaimTracker,
CoverageAnalyzer,InsuranceActionPanel,InsuranceClaimsPanel,
InsurancePoliciesPanel,InsurancePolicyTalk,InsuranceVaultPanel,
InsuranceWalletSection,MutualAidPactsPanel,PolicyVault,QuoteCompare,
InsuranceOverviewPanel}.tsx`.

## The defect: an 8-tab fabricated parallel CRUD system sitting beside a
## fully real one, plus 6 macros with zero frontend caller

This lens is the "real deep backend next to a fabricated parallel CRUD
system" defect class from `CLAUDE.md`, but in an unusual shape: the fake
system wasn't filling a gap — a **fully real, richer implementation of the
exact same Policies/Claims/Vault concepts already existed and was already
mounted** (`InsuranceWalletSection` → `InsurancePoliciesPanel` /
`InsuranceClaimsPanel` / `InsuranceVaultPanel`, always visible at the top of
the page), so the fake tabs were pure redundant dead weight, not a missing
capability.

**Before this pass**, `app/lenses/insurance/page.tsx` had **15 `MODE_TABS`**:
`Dashboard, Policies, Claims, Calculator, Compare, Clients, Commissions,
Compliance, Documents, Vault, ClaimTracker, QuoteCompare, GapAnalysis, AMS,
Pacts`. Eight of them (`Dashboard, Policies, Claims, Calculator, Clients,
Commissions, Compliance, Documents`) read/wrote through
`useLensData<ArtifactDataUnion>('insurance', currentType, …)` with
`ArtifactType = 'Policy' | 'Claim' | 'Quote' | 'InsuredClient' | 'Commission'
| 'ComplianceItem' | 'Document'` — a **generic artifact-CRUD hook with zero
backing macro of any kind**. None of `'Policy'`, `'Claim'`, `'Quote'`,
`'InsuredClient'`, `'Commission'`, `'ComplianceItem'`, `'Document'` is a
registered macro action; `useLensData` hits a generic `/api/lens/:domain/:type`
artifact store, not `domains/insurance.js`. This produced a **second,
divergent policy/claim data model** running in parallel with the real one:

- Different field names throughout: fake `PolicyData.policyType` vs. real
  `policy.kind`; fake `.coverageLimit`/`.namedInsureds`/`.underwriter`/
  `.endorsements` have no real-backend equivalent at all; fake `ClaimData`
  had no `carrier`/`kind` overlap usable by the real `claim-file` shape.
- **Three tabs (`Calculator`/`Quote`, `Clients`/`InsuredClient`,
  `Compliance`/`ComplianceItem`) invented entire agency-management
  sub-products with zero backend support anywhere in the 71 macros** — no
  macro persisted an arbitrary "quote" record, a client/CRM contact record,
  or a CE-credit/license-renewal compliance record at the time of this
  removal pass. Quote/Compliance are still genuinely missing (see below);
  the client/CRM record is **no longer missing — CLOSED (2026-07-12,
  `ddbd111f`)**, see below.
- **`Documents`** duplicated the real, policy-scoped `policy-document-add`/
  `policy-document-list` macros with an untied, generic document library
  (arbitrary `fileName`/`category`, no `policyId`).
- **The "Domain Actions" row** (visible on every non-Dashboard/AMS tab) had
  four buttons — `renewalAlert`, `coverageGap`, `lossRatioReport`,
  `commissionSummary` — wired through `useRunArtifact('insurance')`, which
  POSTs to a **persisted single fake artifact** (`filtered[0]?.id`) rather
  than the user's real book of policies/claims. Since `coverageGap` reads
  `p.type` and the fake artifact has `.policyType`, `coveredTypes` was
  always empty and every run reported all 6 coverage types as "gaps"
  regardless of the user's actual policies — a silent field-shape bug on
  top of operating on the wrong (single, fake) record in the first place.
- **`premiumHistory` and `claimStatus`** had dead render blocks in the
  "Action Result" panel (the JSX matched on `actionResult.averageChangePercent`
  / `actionResult.totalClaims`) but **no button anywhere called them** —
  unreachable code paths for two real macros.

Separately, **7 real macros had zero frontend caller anywhere in the lens**
before this pass: `commissionSummary` (reachable only via the broken
Domain-Actions path above, not really "surfaced"), `premiumHistory`,
`claimStatus`, `coverage-summary`, `renewals-due`, `premium-schedule`,
`policy-update`.

A **7th macro, `policy-update`, also had zero frontend caller** — once a
policy was created there was no way to edit its premium, deductible,
renewal date, or status (e.g. mark it lapsed/cancelled after a rate change),
even though the backend has always supported it.

And **`QuoteCompare.tsx`'s `quotes-compare` macro is an intentional
honest-failure** (`server/domains/insurance.js:391-400` — real carrier quotes
need a paid, per-state-licensed broker API Concord doesn't have, so the
macro always returns `ok:false` with an explanatory message rather than
fabricating premiums). The frontend silently swallowed that message: it only
ever read `res.data?.result?.quotes`, so on `ok:false` the UI just showed
"Click Compare to see quotes" again — indistinguishable from "you forgot to
click," when the honest truth is "this capability needs an API key."

## What changed

### 1. `app/lenses/insurance/page.tsx` — removed the fabricated 8-tab CRUD system

Deleted: the `ArtifactDataUnion`/`PolicyData`/`ClaimData`/`QuoteData`/
`InsuredClientData`/`CommissionData`/`ComplianceItemData`/`DocumentData`
interfaces, `POLICY_TYPES`/`CLAIM_STATUSES`/`QUOTE_STATUSES`/
`RISK_PROFILES`/`PAYMENT_FREQUENCIES`/`COMPLIANCE_TYPES`/`POLICY_ICONS`/
`getStatusesForTab`, all six `useLensData(...)` calls, `useRunArtifact`,
`renderFormFields`/`renderCard`/`renderDashboard` (the fake-data version),
the Editor Modal, the "Domain Actions" row, the "Action Result" panel, the
redundant header Stat-Cards/Policy-Status/Claim-Pipeline blocks (all
computed from the fake `policies`/`claims` arrays — `InsuranceWalletSection`,
mounted above the tab bar on every render, already surfaces the same
territory from the real `insurance-dashboard` macro), and `UniversalActions`
(a generic action array with no meaningful target once the fake artifact ids
were gone).

`MODE_TABS` shrank from 15 to **5, every one macro-backed and
non-overlapping**: `Overview` (new, see below), `Quotes` (`QuoteCompare`,
fixed), `GapAnalysis` (`CoverageAnalyzer`, unchanged, already real),
`AMS` (`AmsWorkbench`, unchanged, already real, 24 macros), `Pacts`
(`MutualAidPactsPanel`, unchanged, already real, out-of-scope death-insurance
surface composed in per the brief). The `Vault` and `ClaimTracker` tabs
(`PolicyVault.tsx` / `ClaimTracker.tsx`, calling only `policy-list`/
`policy-add` and `claim-list`/`claim-file`) were dropped from the tab bar as
**redundant** with the richer, always-visible `InsuranceWalletSection` →
`InsurancePoliciesPanel` (policy CRUD + id-card + payments + documents +
beneficiaries) / `InsuranceClaimsPanel` (claim CRUD + status advance/deny) —
the component files are untouched and still exported, just no longer
double-mounted as a second, thinner tab.

`VisionAnalyzeButton`'s result (previously written into the now-removed fake
claim-form `formData`) now renders as a small dismissible "Vision analysis"
callout the user reads and manually applies via the real `InsuranceWalletSection`
claim form — an honest read-only assist, not a write into nothing.

Added keyboard shortcuts `1`-`5` (via `useLensCommand`) to switch between the
five tabs — discoverable via the command palette/shortcut-help modal,
matching the fluidity invariant's "every scoped command must be discoverable."

### 2. `components/insurance/QuoteCompare.tsx` — surfaces the honest failure

`getQuotes()` now checks `res.data?.ok === false` and renders the backend's
real error message ("Insurance quotes require a live carrier broker
API...") in an amber callout, instead of silently falling through to the
generic "Click Compare to see quotes" empty state that read as user error.

### 3. `components/insurance/InsuranceActionPanel.tsx` — closes 3 of the 6 unsurfaced macros

Added three actions to the existing "book (JSON) + risk" broker workbench,
reusing its established honest, no-seed pattern:
- **`commissionSummary`** — reuses the same pasted policies/claims book,
  renders total commission / effective rate / per-tier breakdown.
- **`claimStatus`** — reuses the same book's `claims` array, renders open
  claims / total claims / total amount / by-status breakdown.
- **`premiumHistory`** — this macro's input shape (`policyNumber` +
  `renewalHistory: [{date, premium}]`) doesn't fit the book shape, so it
  gets its own small **repeatable-row form** (policy number + add/remove
  dated premium points) rather than a second raw JSON textarea, per the
  "designed form, not JSON-paste" bar — renders trend (increasing/
  decreasing/stable) and average % change per renewal.

Also added a placeholder to the book textarea showing the exact expected
field shape (`type`/`premium`/`expiryDate`/`policyNumber`/`commissionRate`/
`tier` for policies; `status`/`amount`/`dateOfLoss` for claims) — a direct
fix for the field-shape-mismatch risk class, since these macros read raw
user-typed JSON with no schema validation UI.

### 4. `components/insurance/InsuranceOverviewPanel.tsx` (new) — closes 2 more unsurfaced macros

Wires `coverage-summary` (active/total policy counts, annual/monthly
premium, a real bar breakdown by policy kind) and `renewals-due` (overdue /
due-within-30-days policies, soonest first, with an overdue/due-soon badge)
into a new "Overview" tab — the lens's default landing tab, replacing the
removed fake `Dashboard`. Matches the visual language of the other real
`#0d1117`/cyan-bordered tabs (`AmsWorkbench`, `CoverageAnalyzer`,
`QuoteCompare`) for consistency.

### 5. `components/insurance/InsurancePoliciesPanel.tsx` — closes the last 2 unsurfaced macros

Added a "Payment plan" section to the policy-detail view: a frequency
selector (monthly/quarterly/semiannual/annual) + "Compute" button calling
`premium-schedule`, rendering the installment amount, last-paid date, and
next-due date with an overdue/due-soon/scheduled badge. Sits above the
existing raw payment-log list, giving the payment history a forward-looking
schedule instead of only a backward-looking ledger.

Added an "Edit policy" toggle to the policy-detail header — a form for
status (active/lapsed/cancelled/pending), renewal date, annual premium, and
deductible, calling `policy-update` and refreshing both the detail view and
the list on save. This was a real, meaningful gap, not just a documentation
note: before this pass there was no way to mark a policy lapsed/cancelled
or update its premium after a rate change anywhere in the lens, even though
`policy-update` has existed in the backend the whole time.

## Macro → UI classification (all 71 macros)

**DESIGNED** (real, bespoke UI, no fabrication) — 71/71 after this pass:

| Macro group | Count | Where |
|---|---:|---|
| `coverageGap`, `lossRatioReport`, `renewalAlert`, `riskScore` | 4 | `InsuranceActionPanel.tsx` (pre-existing, honest JSON-paste book analytics) |
| `commissionSummary`, `claimStatus`, `premiumHistory` | 3 | `InsuranceActionPanel.tsx` (**newly wired this pass**) |
| `policy-list/add/delete/detail`, `policy-document-add`, `payment-log`, `id-card`, `beneficiary-add/list` | 9 | `InsurancePoliciesPanel.tsx` (via `InsuranceWalletSection`; `policy-list` also re-read by `AmsWorkbench.tsx` for its own carrier/renewal/FNOL/statement/certificate/esign forms) |
| `policy-update`, `premium-schedule` | 2 | `InsurancePoliciesPanel.tsx` (**newly wired this pass**) |
| `claim-list/file/update/delete` | 4 | `InsuranceClaimsPanel.tsx` (via `InsuranceWalletSection`) |
| `agent-add/list`, `reminder-create/list/complete`, `asset-add/list` | 7 | `InsuranceVaultPanel.tsx` (via `InsuranceWalletSection`) |
| `insurance-dashboard` | 1 | `InsuranceWalletSection.tsx` stat bar |
| `coverage-summary`, `renewals-due` | 2 | `InsuranceOverviewPanel.tsx` (**new component this pass**) |
| `quotes-compare` | 1 | `QuoteCompare.tsx` (**honest-failure display fixed this pass**) |
| `coverage-analyze` | 1 | `CoverageAnalyzer.tsx` |
| `carrier-add/list/delete/rate`, `renewal-pipeline-build/list/advance`, `fnol-intake/list/update`, `statement-import/list/reconcile`, `certificate-issue/list/export/revoke`, `book-of-business`, `producer-leaderboard`, `esign-create/list/sign`, `binder-issue` | 23 | `AmsWorkbench.tsx` |
| `pact-write/list/revoke/renew/set-auto-renew/pay-premium/premium-schedule/respond/record-payout/payout-history/notifications` | 11 | `MutualAidPactsPanel.tsx` (death-insurance surface, out of scope, pre-existing and real) |
| `policy-document-list`, `payment-list`, `claim-detail` | 3 | Real, registered, no direct caller — but their exact data already ships through a different real macro's response (`policy-detail` bundles `documents`+`payments`; `claim-list` returns each claim with the same `daysSinceSubmit` enrichment `claim-detail` computes). Calling them separately would be a redundant round-trip, not a missing feature. |

Total: 4+3+9+2+4+7+1+2+1+1+23+11+3 = **71**. Matches
`grep -c 'registerLensAction("insurance"' server/domains/insurance.js`.

**GENERIC-STRIP-ONLY**: none found post-rewrite — the removed 8-tab system
was the lens's only generic-scaffold surface, and it's gone.

**UNSURFACED**: none remaining. All 7 previously-unsurfaced macros
(`commissionSummary`, `premiumHistory`, `claimStatus`, `coverage-summary`,
`renewals-due`, `premium-schedule`, `policy-update`) now have real, designed
UI. The 3 macros in the last table row (`policy-document-list`,
`payment-list`, `claim-detail`) are real but their data is already exposed
through a different real macro's bundled response — not a gap.

## Confirmed real and left alone, with reason

Read in full, `grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/insurance/*.tsx` → only the file-header comments that
*describe* the honesty invariant ("no seed/mock/demo data anywhere"), no
actual fabrication:
- **`AmsWorkbench.tsx`** (1,312 LOC) — all 24 Applied Epic/EZLynx-parity
  macros wired, real carrier roster + comparative rating, renewal pipeline,
  FNOL routing, statement reconciliation, ACORD certificate export, book of
  business, producer leaderboard, e-sign + binder issuance. No changes
  needed.
- **`CoverageAnalyzer.tsx`** — real `coverage-analyze`, no changes needed.
- **`MutualAidPactsPanel.tsx`** — real, all 11 `pact-*` macros, handles the
  write/list/respond/renew/pay-premium/revoke/payout-history/notifications
  full lifecycle. Out of scope (death-insurance surface) but verified
  correctly composed in per the assignment brief, no changes needed.
- **`InsurancePolicyTalk.tsx`** — an honest external-feed panel (Reddit
  r/Insurance top posts), same pattern as other lenses' community-signal
  panels, no defect.
- **`InsuranceWalletSection.tsx`**, **`InsuranceClaimsPanel.tsx`**,
  **`InsuranceVaultPanel.tsx`** — already real and already mounted (composed
  by `InsuranceWalletSection`), no changes needed beyond the
  `InsurancePoliciesPanel.tsx` premium-schedule addition above.

## Left unmounted, with reason

- **`PolicyVault.tsx`**, **`ClaimTracker.tsx`** — real, correctly wired
  (`policy-list`/`policy-add`, `claim-list`/`claim-file`), but strictly
  thinner duplicates of `InsurancePoliciesPanel.tsx` / `InsuranceClaimsPanel.tsx`,
  which are always visible above the tab bar. Removed from `MODE_TABS` to
  eliminate redundant UI surface area; the component files are untouched
  (still valid, still exported) in case a future surface wants the compact
  form.

## Genuinely missing, deferred

Real Applied Epic / EZLynx agency-management capabilities with **zero
backend macro** anywhere in the 71-macro surface — these were the concepts
the removed fake `Clients`/`Compliance` tabs were standing in for, and per
the honesty invariant they're relabeled as deferred rather than faked:
- ~~**Client/CRM record management** — a persisted contact record per
  insured client (phone/email/address/DOB/risk-profile/referral-source,
  linked to their policies). No `insurance.*` macro creates or lists such
  a record.~~ **CLOSED (2026-07-12, `ddbd111f`).** Built the
  `client-add`/`client-list` macro pair this row called for:
  `server/domains/insurance.js` gained `client-add` / `client-list` (this
  file's own hyphenated macro-naming convention) plus a `resolveClientRef(
  state, userId, params)` helper, following plumbing's `clientAdd`/
  `clientList`/`resolveClientRef` (`server/domains/plumbing.js`) and
  landscaping's `client-add`/`client-list` — the exact precedent this row
  named — adapted to this domain's STATE-backed `insLens` bucket
  (`globalThis._concordSTATE.insLens.clients`, a per-user Map added
  alongside the existing `policies`/`claims`/`documents`/… buckets in
  `getInsState()`). `client-add` validates a required `name` plus optional
  `phone`/`email`/`address`/`dob`/`riskProfile` (low/standard/elevated/high,
  defaulting to `standard` on an invalid value)/`referralSource`/`notes` —
  the exact field set this row named. `client-list` supports a `query`
  substring filter (case-insensitive) and enriches each client with real
  cross-document history — `policyCount`/`activePolicyCount`/`claimCount`/
  `totalAnnualPremium` — joined on `clientId` against the existing
  `policies` + `claims` stores, closing the "linked to their policies" half
  of the gap. An optional `clientId` was wired additively into the three
  macros that already take insured-identifying free-text fields —
  `policy-add` (stamps `insuredName` + `clientId` onto the policy),
  `claim-file` (stamps `clientId` onto the claim), and `certificate-issue`
  (defaults `certificateHolder`/`insured` from the resolved client only
  where the caller didn't already supply that specific field explicitly) —
  resolving the saved client's name onto the document; an unknown
  `clientId` is rejected with `client_not_found`; omitting `clientId`
  entirely preserves each macro's original behavior byte-for-byte
  (regression-tested). New `concord-frontend/components/insurance/
  ClientAutocomplete.tsx` (mirrors plumbing's/landscaping's
  `ClientAutocomplete.tsx` design — combobox, type-to-search, arrow-key
  navigate, Enter to select, inline "add as new client" when no match —
  restyled to this lens's own blue palette, not a literal cross-lens
  import) is wired into `InsurancePoliciesPanel`'s "Add policy" form and
  `InsuranceClaimsPanel`'s "File claim" form; a new "Clients" tab
  (`InsuranceClientsPanel.tsx`) was added to `InsuranceWalletSection`
  (browse/search/add clients, showing each client's aggregated policy/claim
  book). Tests: 18 new cases in `server/tests/insurance-client-crm.test.js`
  (add/list round-trip, name-required rejection, riskProfile default/
  validation, substring query filter, per-user scoping, `clientId`
  resolution + unknown-`clientId` rejection on `policy-add`/`claim-file`/
  `certificate-issue`, explicit REGRESSION cases proving the no-`clientId`
  path is byte-identical to the pre-change behavior on all three wired
  macros, and cross-document `policyCount`/`activePolicyCount`/
  `claimCount`/`totalAnnualPremium` aggregation including an
  active-vs-lapsed exclusion case), plus 7 new cases in
  `concord-frontend/tests/components/InsuranceClientAutocomplete.test.tsx`
  (placeholder render, substring-filtered dropdown with contact info +
  policy count, click-to-select, free-text edit clears the link, keyboard
  nav, inline create wired through `insurance.client-add`, and exact-match
  suppresses the "add new" option). All pre-existing insurance suites
  (`insurance-lens-macros`, `insurance-domain-parity`,
  `insurance-death-pact-macros`, `death-insurance-lens-macros`,
  `depth/insurance-behavior`) still pass in full (120/120 combined with the
  new file) — the change is additive, not a rewrite.
- ~~**Producer compliance tracking** — CE-credit progress, license renewal
  dates, E&O insurance status, carrier-appointment tracking. No backend
  macro tracks any of this.~~ **CLOSED (2026-07-16, `1383984a`).**
  `server/domains/insurance.js` gained `producer-compliance-add`/
  `producer-compliance-list`/`producer-compliance-update`/
  `producer-compliance-remove`, attached to the EXISTING `agent-add`/
  `agent-list` roster — this codebase's "producer" is the agent/broker
  entity already there, so no new entity was invented. Four categories with
  genuinely distinct fields (not one generic shape): `ce_credits` tracks
  progress toward a requirement (`creditsCompleted`/`creditsRequired`, a
  divide-by-zero-guarded `creditsPercent`, an optional cycle deadline);
  `license_renewal` (license number, state, required expiry);
  `eo_insurance` (carrier, policy number, required expiry);
  `carrier_appointment` (carrier name, optional appointment number, optional
  expiry). `agentId` is validated against the real roster (`agent not
  found` on a fabricated id); `category` is HARD-rejected on an invalid
  value — deliberately not soft-defaulted the way some of this file's older
  enums are, since a mis-tracked compliance category is a real
  licensing-risk honesty concern, not a cosmetic mis-tag. `status`
  (overdue/due_soon/scheduled, via the existing `dueState()` helper) and
  `agentName`/`agentFound` are re-derived LIVE on every `producer-
  compliance-list` call — the same live-rederivation-honesty pattern this
  session applied to masonry/landscaping/plumbing job-linkage and history's
  event-linkage: an agent removed after a compliance record was created
  surfaces honestly as `agentFound:false`. This is the 4th instance this
  session of the read-time-derived cert-expiry pattern (plumbing's
  `techCertAdd`/`techCertList`, masonry's `cert-add`/`cert-list`,
  landscaping's `cert-add`/`cert-list`), adapted to insurance's own
  hyphenated macro-naming + `insLens` Map convention. Frontend: new
  `ProducerCompliance.tsx`, an 8th tab in `AmsWorkbench.tsx` — the add/edit
  form is genuinely category-adaptive (the rendered fields change per
  selected category, not one generic field set), the producer picker is a
  real `<select>` sourced from `agent-list` (never free text), status
  badges are overdue=red/due_soon=amber/scheduled=neutral, a progress bar
  renders for `ce_credits`, and `overdueCount`/`dueSoonCount` are surfaced
  as prominent stat tiles at the top — a licensing-compliance risk panel
  needs "N producers have overdue items" visible at a glance, not buried in
  a list. Tests: 40 new behavioral cases in `server/tests/depth/insurance-
  producer-compliance-behavior.test.js` (add/list/update/remove round-trip
  for all 4 categories, category-specific required-field validation, a
  fabricated `agentId` rejection, an unrecognized-category hard-rejection,
  the live agent-removal honesty case, `dueState` correctness, `creditsPercent`/
  `creditsComplete` derivation including the divide-by-zero guard, and a
  partial-update regression) plus 16 new cases in `concord-frontend/tests/
  components/ProducerCompliance.test.tsx` (render, the category-adaptive
  form switching across all 4 categories, create/update/delete flows,
  validation rejection, status-badge rendering, and the since-removed-agent
  honesty case). All 137 pre-existing insurance backend tests still pass
  alongside the new ones (177/177 combined, 0 regressions). This closes
  insurance's entire ENGINEERING-class deferred list — only the paid-API
  carrier-quote-comparison item remains, correctly DATA-SOURCING.

## Verification

- `node --check server/domains/insurance.js` — clean (file untouched this
  pass; verified anyway since the assignment brief requires it for any
  touched backend file).
- `node --test tests/insurance-lens-macros.test.js
  tests/insurance-domain-parity.test.js
  tests/insurance-death-pact-macros.test.js
  tests/depth/insurance-behavior.test.js` (from `server/`) — **92/92 pass**,
  unmodified.
- `npx eslint app/lenses/insurance/page.tsx components/insurance/*.tsx`
  (from `concord-frontend/`) — clean, exit 0.
- `npx tsc --noEmit` (from `concord-frontend/`) — zero new errors; the only
  errors in the full-repo run are pre-existing, in unrelated lenses
  (`components/ethics/DecisionToolkit.tsx`, `components/events/EventOps.tsx`).

### 2026-07-12 update — Client/CRM closure verification

This pass DID touch the backend (`server/domains/insurance.js`), unlike the
frontend-only pass the block above describes:

- `node --check server/domains/insurance.js` — clean.
- `cd server && npx eslint domains/insurance.js tests/insurance-client-crm.test.js`
  — 0 errors/warnings.
- `cd server && DB_PATH=/tmp/insurance-verify-<ts>.db NODE_ENV=test node --test
  tests/insurance-lens-macros.test.js tests/insurance-domain-parity.test.js
  tests/insurance-death-pact-macros.test.js tests/death-insurance-lens-macros.test.js
  tests/insurance-client-crm.test.js` — **120/120 pass** (102 pre-existing +
  18 new; 0 regressions). `tests/depth/insurance-behavior.test.js` (real
  server boot) also re-run clean at 17/17, unmodified.
- `cd concord-frontend && npx vitest run tests/components/InsuranceClientAutocomplete.test.tsx`
  — **7/7 pass**.
- `cd concord-frontend && npx eslint components/insurance/ClientAutocomplete.tsx
  components/insurance/InsuranceClientsPanel.tsx components/insurance/InsuranceWalletSection.tsx
  components/insurance/InsurancePoliciesPanel.tsx components/insurance/InsuranceClaimsPanel.tsx
  tests/components/InsuranceClientAutocomplete.test.tsx` — 0 errors/warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` — **0 errors project-wide.**
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, matching the expected
  post-pass baseline (insurance was already WIRED and stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) — insurance
  entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"bespokeRatio": 0.94`, `"pillarsPresent": 5`, `"antiPatterns": 0`.
  `audit/` outputs reverted via `git checkout -- audit/` per the transient-
  artifact rule.
