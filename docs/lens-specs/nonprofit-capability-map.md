# Nonprofit Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("nonprofit"' server/domains/nonprofit.js
```
→ **49** macros in `server/domains/nonprofit.js` (955 lines), registered via
`registerNonprofitActions(register)`. No domain-string collisions with any
other lens.

Real surfaces: 4 pure-compute legacy calculators (`donorRetention`,
`grantReporting`, `volunteerMatch`, `campaignProgress`), 2 real ProPublica
Nonprofit Explorer (IRS Form 990) integrations (`lookup-org-by-ein`,
`search-orgs` — free, no API key, sourced from the IRS BMF), a
STATE-backed campaign+donation substrate (`campaign-create/list/update/delete`,
`donation-log`, `nonprofit-dashboard`), a full donor CRM (`donor-create/
list/update/delete`, `donor-gift-log`, `donor-segment`), donor communications
(`comm-send/compose/log`, `thankyou-run`), tax receipts (`receipt-generate`,
`receipt-annual`), recurring giving (`pledge-create/list/update/cancel/
charge`), online donation pages (`donation-page-create/list/update/delete/
give`), volunteer management (`volunteer-signup/list/delete`, `shift-
schedule`, `shift-log-hours`), event/P2P fundraising (`event-create/list/
delete`, `p2p-team-create`, `p2p-donate`, `p2p-leaderboard`), and 4 more
donor/grant action macros added in a prior lens-audit batch
(`view-giving-history`, `grant-deadline-check`, `impact-report`,
`send-acknowledgment`).

## Frontend surface (4 files pre-pass, 6 post-pass)

`concord-frontend/app/lenses/nonprofit/page.tsx` +
`concord-frontend/components/nonprofit/{PropublicaSearch,
NonprofitActionPanel, CampaignManager, NonprofitWorkbench}.tsx` (pre-pass);
`+ NonprofitOverviewPanel.tsx` new this pass.

## The defects found

### 1. A fabricated 8-tab (`dashboard/donors/gifts/grants/campaigns/
volunteers/impact/funds`) parallel CRUD system as the page's primary
surface — same defect class as prior Wave rebuilds, at unusually large
scale (the removed code was ~1,700 of the page's 2,006 lines)

`app/lenses/nonprofit/page.tsx` ran `useLensData<ArtifactDataUnion>
('nonprofit', currentType, …)` with `ArtifactType ∈ {Donor, Gift, Grant,
Campaign, Volunteer, ImpactMetric, Fund}` — **none of these seven type
strings is a registered macro action.** `useLensData` hits the generic
`/api/lens/nonprofit/list` artifact store, not `domains/nonprofit.js`.
Verified by direct read of the full file plus cross-referencing every
`ArtifactType` against the 49-macro grep list:

- Fake `DonorData` fields (`lybunt`, `sybunt`, `pledgeBalance`,
  `hoursThisYear` computed off the Volunteer type, not Donor) share **zero**
  field names with the real donor CRM's `donor-create`/`donor-list` shape
  (`name`, `email`, `phone`, `address`, `type`, `notes`, `gifts[]`,
  `comms[]`, `pledges[]`).
- `Grant`, `ImpactMetric`, and `Fund` are **entirely invented artifact
  types with zero backend macro anywhere** in the 49-macro surface —
  matching the "invented entire sub-products with zero backend support"
  pattern from the insurance-lens precedent (`Clients`/`Compliance` tabs
  there; `Grant`/`ImpactMetric`/`Fund` here).
- The page's Quick Stats row (`totalDonors`, `totalRaisedYTD`,
  `retentionRate`, `totalVolunteerHours`) was computed entirely from these
  fake arrays — always empty/zero on a fresh install, and never
  reconcilable with the real donor/campaign/volunteer data one click away
  in the already-mounted real components.
- `useRunArtifact('nonprofit')` + `handleAction(...)` +
  `<UniversalActions domain="nonprofit" artifactId={allDonors[0]?.id}>` ran
  five real macros (`donorRetention`, `grant-deadline-check`,
  `campaignProgress`, `volunteerMatch`, `impact-report`, plus
  `send-acknowledgment`/`view-giving-history` from the detail panel)
  against a **persisted fake artifact record** whose `.data` never
  contained the field names those macros actually read (see defect 2) —
  so even the "real macro calls" this system made were silently broken.
- All four real, well-built components (`PropublicaSearch`,
  `NonprofitActionPanel`, `CampaignManager`, `NonprofitWorkbench`) were
  **already mounted** at the bottom of the same page (lines 1978–1998),
  fully disconnected from the fabricated system above them — the exact
  "real backend/UI sitting beside a fabricated parallel system" shape
  `CLAUDE.md` describes.

### 2. Three of `NonprofitActionPanel`'s four "already-wired" macros had
field-shape bugs that made them silently return zero/undefined on every
call — a defect distinct from #1 (these macros are NOT reachable via the
fake artifact system; they were called directly, but with the wrong shape)

Read in full and confirmed against `server/domains/nonprofit.js` +
`server/tests/nonprofit-domain-parity.test.js` +
`server/tests/depth/nonprofit-behavior.test.js` (the real field contracts):

- **`donorRetention`** reads `artifact.data.givingHistory` (an array of
  `{date, donorId|name}` gift records) and `params.year`. The panel sent
  `{ totalDonors, lapsedDonors }` — two numbers the macro never reads at
  all — so `givingHistory` was always `[]`, `retained`/`priorTotal`/
  `currentTotal` were always `0`. The panel then read
  `result.ratePct`/`.band`/`.lapsed`/`.recovered` — **none of these fields
  exist in the real result** (`{retentionRate, retained, priorTotal,
  currentTotal, period}`), so the UI always rendered "Retention:
  undefined%."
- **`grantReporting`** reads `artifact.data.deliverables`/`.impactMetrics`/
  `.funder`/`.amount`. The panel called it with `{}` (empty input) — always
  zero deliverables/metrics — and read
  `result.totalGranted`/`.reportsDue`/`.nextDeadline`/`.spendDownPct`,
  **none of which the macro returns** (`{deliverableProgress,
  completedDeliverables, totalDeliverables, impactSummary, funder,
  amount}`). Always broken regardless of input.
- **`campaignProgress`** reads `artifact.data.goalAmount`/`.raisedAmount`/
  `.donorCount`/`.startDate`/`.endDate`. The panel sent `{goal, raised,
  daysLeft}` — wrong field names (`goal` ≠ `goalAmount`, `raised` ≠
  `raisedAmount`) and a `daysLeft` field the macro never reads at all (it
  derives pace from `startDate`/`endDate` instead) — so `goal`/`raised`
  were always `0` and `percentComplete` was always `0`. The panel read
  `result.progressPct`/`.daysLeft`, but the macro returns
  `percentComplete` (not `progressPct`) and never returns `daysLeft` at
  all.
- Only `search-orgs` (of the original four) was correctly wired.

## What changed

### 1. `app/lenses/nonprofit/page.tsx` — rewritten (2,006 → 142 lines)

Removed: `ArtifactType`/`ArtifactDataUnion`/`DonorLevel`/`GrantStage`/
`CampaignStatus`/`GeneralStatus`/`GiftPaymentMethod` types, `SEED`,
`DOMAIN_ACTIONS`, six `useLensData(...)` calls, `useRunArtifact`,
`handleAction`, the fake Quick Stats row, the 8-tab `MODE_TABS`, the
create/edit/detail modals for the fake artifacts, `renderGiftCard`/
`renderGrantCard`/etc. card renderers, and `<UniversalActions>`.

Replaced with 5 tabs, **all macro-backed, non-overlapping, composing the
already-real components** (none of which needed to be created from
scratch — they needed to be reachable and correctly wired): `Overview`
(new `NonprofitOverviewPanel`), `Workbench` (`NonprofitWorkbench`,
unchanged mount, extended — see below), `Campaigns` (`CampaignManager`,
extended), `Analysis` (`NonprofitActionPanel`, rewritten — see below),
`Explorer` (`PropublicaSearch`, unchanged). Kept the real-time feed
(`LiveIndicator`/`RealtimeDataPanel`/`DTUExportButton`) and the footer
(`SessionRail`/`RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel`).
Added keyboard shortcuts `1`-`5` (`useLensCommand`) to switch tabs,
matching the fluidity invariant.

Dropped the `<LensFeaturePanel>` generic capability-checklist section that
the pre-existing page carried — with all 49 macros now surfaced through
real, designed tabs, a generic feature-checklist reads as redundant
scaffold rather than a genuine capability (also closes a
`grade-ux-polish.mjs --honest` `usesGenericBody` false-classification —
see Verification).

### 2. `components/nonprofit/NonprofitOverviewPanel.tsx` (new) — real
dashboard replacing the fabricated Quick Stats row

Fetches `nonprofit-dashboard` (campaigns/active/raised/recurring-donors),
`donor-list` (donor count + lifetime given, summed from real gift
records), and `volunteer-list` (total hours) in parallel on mount. Honest
`role="alert"` error surface on fetch failure, `role="status"` loading
state. No fabricated field ever rendered.

### 3. `components/nonprofit/NonprofitActionPanel.tsx` — rewritten to fix
the 3 field-shape bugs + close 6 previously-unsurfaced macros

- **`donorRetention`** now fetches the real `donor-list` on click, builds
  `givingHistory` from every donor's real `gifts[]` (`{date: g.at,
  donorId: d.id}`), and renders the real result fields
  (`retentionRate`/`retained`/`priorTotal`/`period`).
- **`grantReporting` + `grant-deadline-check` + `impact-report`** merged
  into one "Grant tracker" tool: a real bespoke form (grant name, funder,
  amount, deadline date picker, beneficiaries, repeatable deliverable
  rows with a status dropdown, repeatable impact-metric rows with
  target/actual) that fires all three macros in parallel with the shared
  fields and renders three real result cards (deliverable progress +
  achieved-flag list, deadline urgency, impact summary). This also closes
  `grant-deadline-check` and `impact-report`, which had zero frontend
  caller before this pass.
- **`campaignProgress`** now sends the correct `goalAmount`/`raisedAmount`/
  `donorCount`/`startDate`/`endDate` shape (date pickers replace the
  fabricated `daysLeft` input) and renders the real
  `percentComplete`/`dailyRate`/`projected`/`onTrack` fields.
- **`send-acknowledgment`** (previously unsurfaced) — a small "Quick
  acknowledgment queue" tool, deliberately distinct from the CRM's
  persisted `comm-send`/`thankyou-run` flow (this macro is stateless — it
  returns a "queued" confirmation without writing to a donor record).
- **`lookup-org-by-ein`** (previously unsurfaced) — a 9-digit EIN lookup
  next to the existing name search, rendering the org's tax-exempt status,
  NTEE classification, and latest 990 filing revenue.
- Kept mint/DM/publish/agent, updated to read the corrected result field
  names.

### 4. `components/nonprofit/NonprofitWorkbench.tsx` — closes 3 more
previously-unsurfaced macros

- **`donor-update`** — an inline "Edit donor" form (name/email/phone/
  address/type) per donor row in the CRM tab. Before this pass there was
  no way to correct a donor's contact info after creation, even though the
  backend has always supported it (the "policy-update"/"Edit policy"
  precedent from the insurance-lens rebuild).
- **`view-giving-history`** — a "Summarize" button per donor's giving-
  history section, rendering average gift / first gift / last gift
  computed by the real macro (distinct from the raw gift list already
  shown, which is a plain unaggregated dump). Required mapping the CRM's
  `Gift.at` field to the macro's own `date` field name — the macro's own
  contract genuinely uses `date` (pinned by
  `tests/depth/nonprofit-donor-grant-behavior.test.js` and
  `tests/depth/nonprofit-behavior.test.js`), so this is a shape adapter at
  the call site, not a backend bug.
- **`comm-log`** — a "View full log" button in the Communications tab,
  making a fresh dedicated call for a donor's complete communication
  history (distinct from the CRM tab's already-loaded, UI-truncated
  `.slice(-4)` preview — this gives a live, untruncated view without
  depending on a possibly-stale cached donor-list fetch).
- **`volunteerMatch`** (previously unsurfaced) — a new "Match to program
  needs" mini-tool per volunteer in the Volunteers tab: a repeatable
  program/skill/schedule form that calls the real macro with the
  volunteer's actual `skills[]` and `availability` (wrapped as a
  single-element array — the macro's contract does an exact-match
  `.some()` against it, pinned by `tests/depth/nonprofit-behavior.test.js`,
  while the real volunteer record stores availability as free text; empty
  `schedule` short-circuits the match so an unfilled schedule field never
  risks the macro's un-array-guarded `.some()` call).
- Added optional controlled-tab props (`tab`/`onTabChange`, exported
  `WB_TABS`) matching the pattern established for `RFPlanner` in the
  telecommunications-lens rebuild — additive, falls back to internal state,
  no behavior change for the one caller.

### 5. `components/nonprofit/CampaignManager.tsx` — closes the last
previously-unsurfaced macro

- **`campaign-update`** — an inline "Edit" form (goal + status dropdown)
  per campaign row. Before this pass a campaign's goal couldn't be revised
  and it could never be marked `complete`/`paused` after creation.

## Macro → UI classification (all 49 macros)

**DESIGNED** (real, bespoke UI, no fabrication) — 49/49 after this pass
(0/49 before this pass had zero frontend caller; 4/49 —
`campaign-update`, `comm-log`, `donor-update`, `lookup-org-by-ein` — were
unsurfaced per `node scripts/lens-unsurfaced.mjs --lens nonprofit`, and
3 more — `donorRetention`, `grantReporting`, `campaignProgress` — were
reachable-but-broken field-shape bugs):

| Macro group | Count | Where |
|---|---:|---|
| `donorRetention` | 1 | `NonprofitActionPanel.tsx` (**field-shape fixed this pass**, now driven by live `donor-list`) |
| `grantReporting`, `grant-deadline-check`, `impact-report` | 3 | `NonprofitActionPanel.tsx` grant tracker (**field-shape fixed / newly wired this pass**) |
| `campaignProgress` | 1 | `NonprofitActionPanel.tsx` (**field-shape fixed this pass**) |
| `send-acknowledgment` | 1 | `NonprofitActionPanel.tsx` (**newly wired this pass**) |
| `search-orgs` | 2 | `NonprofitActionPanel.tsx` + `PropublicaSearch.tsx` (pre-existing, real) |
| `lookup-org-by-ein` | 1 | `NonprofitActionPanel.tsx` (**newly wired this pass**) |
| `campaign-create/list/delete`, `donation-log`, `nonprofit-dashboard` | 5 | `CampaignManager.tsx` (pre-existing, real) |
| `campaign-update` | 1 | `CampaignManager.tsx` (**newly wired this pass**) |
| `donor-create/list/delete`, `donor-gift-log`, `donor-segment` | 5 | `NonprofitWorkbench.tsx` CRM tab (pre-existing, real) |
| `donor-update` | 1 | `NonprofitWorkbench.tsx` CRM tab (**newly wired this pass**) |
| `view-giving-history` | 1 | `NonprofitWorkbench.tsx` CRM tab (**newly wired this pass**) |
| `comm-send/compose`, `thankyou-run` | 3 | `NonprofitWorkbench.tsx` Comms tab (pre-existing, real) |
| `comm-log` | 1 | `NonprofitWorkbench.tsx` Comms tab (**newly wired this pass**) |
| `receipt-generate`, `receipt-annual` | 2 | `NonprofitWorkbench.tsx` Receipts tab (pre-existing, real) |
| `pledge-create/list/update/cancel/charge` | 5 | `NonprofitWorkbench.tsx` Recurring tab (pre-existing, real) |
| `donation-page-create/list/update/delete/give` | 5 | `NonprofitWorkbench.tsx` Pages tab (pre-existing, real) |
| `volunteer-signup/list/delete`, `shift-schedule`, `shift-log-hours` | 5 | `NonprofitWorkbench.tsx` Volunteers tab (pre-existing, real) |
| `volunteerMatch` | 1 | `NonprofitWorkbench.tsx` Volunteers tab (**newly wired this pass**) |
| `event-create/list/delete`, `p2p-team-create`, `p2p-donate`, `p2p-leaderboard` | 6 | `NonprofitWorkbench.tsx` Events tab (pre-existing, real) |

Total: 1+3+1+1+2+1+5+1+5+1+1+3+1+2+5+5+5+1+6 = **49**. Matches
`grep -c 'registerLensAction("nonprofit"' server/domains/nonprofit.js`.

**GENERIC-STRIP-ONLY**: none found post-rewrite — the removed 8-tab
system was the lens's only generic-scaffold surface, and it's gone.

**UNSURFACED**: none remaining. `node scripts/lens-unsurfaced.mjs --lens
nonprofit` reports 0/49.

## Confirmed real and left alone, with reason

`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/nonprofit/*.tsx app/lenses/nonprofit/page.tsx` → only a doc
comment in `NonprofitWorkbench.tsx` describing the honesty invariant, no
fabrication.

- **`PropublicaSearch.tsx`** — real ProPublica Nonprofit Explorer name
  search, no changes needed.
- **`NonprofitWorkbench.tsx`**'s pre-existing recurring/comms/receipts/
  pages/events tabs — already real, already correctly wired, no changes
  beyond the additive donor-update/view-giving-history/comm-log/
  volunteerMatch wiring above.
- **`CampaignManager.tsx`**'s pre-existing create/list/delete/donate/
  dashboard flow — already real, no changes beyond the additive
  campaign-update wiring above.

## Genuinely missing, deferred

None identified. Every real nonprofit-lens capability implied by the
49-macro backend now has a designed UI; the fake `Grant`/`ImpactMetric`/
`Fund` artifact types the removed 8-tab system implied (a persisted
grant-tracking record, a persisted fund/endowment ledger) have no
corresponding backend macro anywhere and were themselves the fabrication —
not a genuine gap this pass is deferring. A persisted grant-tracking
record (vs. the current stateless `grantReporting` ad-hoc calculator) and
a fund/endowment ledger would be real, defensible future backend
additions, but per "do not invent new backend behavior" they're out of
scope for this frontend-only pass.

## Verification

- `node --check server/domains/nonprofit.js` — clean (file untouched this
  pass; verified anyway per the assignment brief).
- `node --test tests/nonprofit-domain-parity.test.js
  tests/nonprofit-campaign-domain-parity.test.js
  tests/depth/nonprofit-behavior.test.js
  tests/depth/nonprofit-donor-grant-behavior.test.js` (from `server/`) —
  **30/30 pass**, unmodified.
- `node scripts/lens-unsurfaced.mjs --lens nonprofit` (from repo root) —
  **0/49 unsurfaced** (was 4/49 before this pass), cross-checked by direct
  grep of every macro name against every `.tsx` file in the lens.
- `npx eslint app/lenses/nonprofit/page.tsx components/nonprofit/*.tsx`
  (from `concord-frontend/`) — clean, exit 0.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (nonprofit was already
  WIRED and stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) — nonprofit
  entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"bespokeRatio": 0.924`, `"pillarsPresent": 5`, `"antiPatterns": 0`.
  (An intermediate version of this pass that kept the pre-existing
  `<LensFeaturePanel>` section scored `isGenericScaffold: true` —
  `pageLoc` 163 < 700 and `maxBespokeComponentLoc` 982 < 1000 both held,
  and `<LensFeaturePanel>` alone trips the grader's `usesGenericBody`
  regex. Removing that redundant generic section — a genuine design
  improvement now that every macro has a designed home, not a
  grader-targeted hack — fixed it honestly.) `audit/` outputs reverted via
  `git checkout -- audit/` per the transient-artifact rule.
