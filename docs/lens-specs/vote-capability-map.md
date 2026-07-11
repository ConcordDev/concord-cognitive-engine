# Vote — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. **Reference apps / category leaders: Decidim, Snapshot,
and Polis** (Decidim for the poll lifecycle + quorum/threshold governance
shape, Snapshot for the multi-method voting + liquid-democracy delegation
shape, Polis for the opinion-clustering shape). The bar: would this hold up
shipped standalone against those three, not "good enough next to 259
siblings."

## Backend surface — `server/domains/vote.js` (14 macros, all real)

Per-process store on `globalThis._concordSTATE.voteLens` (`polls` /
`ballots` / `delegations` / `receipts` Maps, debounce-persisted); no mock
or seed data — an empty substrate renders empty states.

- **Electoral-science tools (3, stateless):** `tallyVotes` (plurality +
  Borda count + approval-derived + Condorcet winner + cycle detection,
  computed together so methods can be compared), `fairnessCheck`
  (Gallagher disproportionality index, majority-criterion verification,
  burying/compromise strategic-voting detection, Laakso-Taagepera
  effective-candidate count), `consensusMeasure` (Fleiss' kappa, Shannon
  entropy disagreement, bimodality-based polarization index). These take
  raw `{candidates, ballots}` (or `{ratings}`) directly in the input body —
  no persisted artifact needed.
- **Polis/Decidim/Snapshot governance substrate (11, stateful):**
  `poll-create` (5 methods: plurality/ranked-IRV/approval/score/quadratic,
  quorum, pass-threshold, eligibility list, custom weighting), `poll-list`,
  `poll-close` (owner-only), `cast-ballot` (method-specific shape,
  eligibility + lifecycle gate, verifiable receipt via a deterministic
  content hash, re-cast overwrites), `delegate-vote` / `revoke-delegation`
  / `delegation-list` (liquid democracy, cycle-guarded, global or
  per-poll scope), `poll-results` (tallies via the poll's method, folds in
  delegated weight, resolves pass/fail against quorum + threshold, returns
  a consensus-over-time series), `opinion-cluster` (Polis-style: cosine
  similarity + greedy seeding groups voters into agreement clusters,
  flags consensus vs. divisive statements), `audit-trail` /
  `verify-receipt` (per-ballot verifiable receipts + hash verification).

## What was already real/wired (all DESIGNED)

`concord-frontend/components/vote/GovernanceWorkbench.tsx` (1190 LOC) is a
complete, correctly-wired implementation of the 11-macro governance
substrate — poll create/list/detail, a method-specific ballot-casting form
per voting method, a results panel with tally + IRV-round breakdown +
consensus-over-time chart, a delegation panel, an audit-trail panel with
per-receipt verification, and a Polis-style opinion-clustering tool. Every
value it renders traces to a real macro call with the exact field shape the
macro returns — confirmed by direct comparison against
`server/domains/vote.js`. This component was already correct before this
pass; it is unchanged.

`concord-frontend/components/vote/VoteFeed.tsx` is a real DATA-SOURCING
feature — live Reddit r/EndFPTP / r/PoliticalDiscussion / r/NeutralPolitics
/ r/governmentnonsense feed (top posts by day/week/month), with a
"save as DTU" action. Real external data, not fabricated. Unchanged.

## The defect found + what changed

The page (`app/lenses/vote/page.tsx`) had **three tabs**: `proposals`
(default/first tab), `governance` (the real workbench above), and
`dashboard`. The `proposals` and `dashboard` tabs were the recurring
Wave-3 pattern — **a whole fake multi-tab dashboard sitting beside an
already-real, already-wired component doing the same job**:

1. **Fake generic-CRUD proposal system.** `proposals` used
   `useLensData('vote', 'proposal', …)` — a generic artifact CRUD hook —
   to fabricate an entire parallel "governance proposal" concept
   (title/description/type/status/votesFor/votesAgainst/votesAbstain/
   threshold/deadline/comments) that has **no backing macro at all**. It
   duplicated exactly what `poll-create`/`poll-list`/`cast-ballot`/
   `poll-results` already do for real, just as untyped generic artifacts
   instead of the real governance substrate.
2. **Vote casting was wired to the wrong domain and silently never
   updated the counts it displayed.** The "For / Against / Abstain"
   buttons called `apiHelpers.council.vote({dtuId: proposalId, vote, …})`
   — the **`council` domain's** `vote` macro
   (`registerLensAction("council", "vote", …)` at `server.js:39921`),
   which appends to a `council`-domain artifact's `votes[]` array. The
   proposal card read its counts from `item.data.votesFor` /
   `votesAgainst` / `votesAbstain` on a **`vote`-domain** artifact — a
   field the `council.vote` call never touches, on a different domain's
   storage entirely. Every vote click showed a spinner, presumably
   succeeded (the `council.vote` macro doesn't validate domain
   consistency), and the displayed vote counts never moved. A fabricated
   success on a control the user could see doing nothing.
3. **The `dashboard` tab's "Vote Actions Panel" called real macros with
   both the wrong input AND the wrong expected output shape.** It used
   `useRunArtifact('vote')` → `POST /api/lens/vote/:id/run` with
   `id = proposalItemId` (the fake proposal artifact from defect #1) and
   `action` ∈ `{tallyVotes, fairnessCheck, consensusMeasure}`. Those three
   macros read `artifact.data.ballots` / `.approvals` / `.ratings` — a
   proposal artifact has none of those fields, so every single click
   returned `{ok:false, error:"No ballots or approval data provided."}`
   (traced through `server/domains/vote.js:15-21` — confirmed by reading
   the handler, not guessed). Even setting that aside, the render code
   read field names (`r.outcome`, `r.votesFor`, `r.forPercent`,
   `r.isFair`, `r.fairnessScore`, `r.consensusLevel`, `r.consensusScore`,
   `r.recommendation`) that **do not exist anywhere in the real return
   shapes** — `tallyVotes` returns `{candidates, plurality, bordaCount,
   approvalVoting, condorcet, methodAgreement, overallWinner, …}`,
   `fairnessCheck` returns `{voteShares, gallagherIndex,
   majorityCriterion, strategicVoting, pairwiseLosses, …}`,
   `consensusMeasure` returns `{fleissKappa, entropy, polarizationIndex,
   itemConsensus, overallConsensus, …}`. This was a real macro reached
   through completely fabricated glue code on both sides of the call —
   the exact "wrong field shapes so calls silently fail" pattern named in
   the rebuild-loop brief.

**Fix: removed the fake `proposals`/`dashboard` tabs and their glue code
in full** (`CreateProposalModal`, `DiscussionThread`, `ResultsDashboard`,
the `castVote` mutation, the `useLensData` proposal hook) rather than
patch the field-shape bugs, because the governance/proposal concept those
tabs modeled was **already real** in `GovernanceWorkbench` — patching the
fake system would have kept two competing, differently-shaped proposal
concepts on the same page. In its place:

- **The page now has two tabs: Governance Workbench (default) and a new
  Ballot Analysis Lab.** `components/vote/BallotAnalysisLab.tsx` (new,
  ~330 LOC) is a bespoke UI wired **directly** to `tallyVotes` /
  `fairnessCheck` / `consensusMeasure` via `lensRun('vote', <macro>,
  {candidates, ballots})` — no persisted artifact, matching the
  documented `POST /api/lens/run` virtual-artifact contract. Candidates
  are a poll-options-style editable list; each ballot is entered via a
  click-to-rank UI (reused from `GovernanceWorkbench`'s ranked-ballot
  pattern) so a user can paste in a real election's raw rankings or build
  a hypothetical. Results render the **actual** field shapes from each
  macro (verified against `server/domains/vote.js` line-by-line, not
  assumed) — plurality/Borda/approval/Condorcet side-by-side with method
  agreement, Gallagher index + majority-criterion + strategic-voting
  patterns, Fleiss' kappa + entropy + polarization with most-agreed/most-
  disputed item breakdowns. A "Load worked example" button explicitly
  loads a labeled 3-candidate/5-ballot demo on user action — never
  auto-loaded, never rendered as if it were live data.
  - This is a genuinely distinct feature from the live poll flow — an
    electoral-science scratch pad (the kind of tool FairVote /
    electionscience.org publish write-ups with) rather than a duplicate
    of poll voting. It is also new category-leadership surface: none of
    Decidim/Snapshot/Polis ship a multi-method side-by-side comparison +
    fairness/consensus toolkit as a first-class feature.
- **The header stat row is now sourced from real `poll-list` data**
  (Active Polls / Ballots Cast / Resolved Polls / Avg Ballots per Poll via
  a page-level `poll-list` query) instead of the fake proposal
  aggregates (Active Proposals / Votes Cast / Pass Rate / Avg
  Participation, all computed from the fabricated CRUD data).
- `UniversalActions` lost its `artifactId={proposalItems[0]?.id}` prop
  (that artifact no longer exists) — it now runs in domain-only mode,
  which the component already supports (`artifactId?: string | null`).

## Investigated and honestly deferred

- **Gallagher index needs a `results` (seat-share) map** the
  `fairnessCheck` macro accepts but the Ballot Analysis Lab doesn't
  currently collect from the UI — the lab shows the honest "no seat/result
  shares supplied" empty state for that one sub-metric rather than fake a
  seat map. **ENGINEERING** (small, deferred): a seat-allocation input
  would need its own bespoke editor; the other majority-criterion +
  strategic-voting metrics work fully without it.
- **`opinion-cluster`** was already wired in `GovernanceWorkbench` (the
  "Opinion Clusters" view toggle) — confirmed real and unchanged, not
  re-audited in depth this pass beyond the field-shape spot-check above.

## Category-leadership caliber judgment (fourth invariant)

`GovernanceWorkbench` genuinely holds up next to Decidim/Snapshot for the
poll lifecycle (5 voting methods including quadratic, quorum/threshold
resolution, liquid-democracy delegation with cycle detection, verifiable
per-ballot receipts) and next to Polis for opinion clustering (cosine-
similarity greedy clustering, consensus vs. divisive statement detection).
The new Ballot Analysis Lab is caliber-additive, not caliber-filling — it
gives the lens a research-grade electoral-science surface none of the
three reference apps offer natively. The fixed defects were real
regressions (a dead vote button, a fabricated proposal system, a broken
analysis panel) sitting next to already-best-in-class work, not gaps in
the best-in-class work itself.

## Verification

- `node --check server/domains/vote.js` — syntax OK (file untouched this
  pass; the defects were entirely frontend-side).
- `node --test server/tests/vote-domain-parity.test.js` — 28/28 passing
  (unmodified; confirms the backend contract the new frontend code now
  targets correctly).
- `cd concord-frontend && npx eslint app/lenses/vote/page.tsx
  components/vote/GovernanceWorkbench.tsx components/vote/VoteFeed.tsx
  components/vote/BallotAnalysisLab.tsx` — 0 errors, 0 warnings.
- `node scripts/verify-lens-backends.mjs` — `vote` still WIRED; run total
  `{"WIRED":258,"NO-BACKEND-CALL":2}` / 260.
- `node scripts/grade-ux-polish.mjs --honest` — `vote` entry:
  `tier: "polished"`, `isGenericScaffold: false`, `antiPatterns: 0`,
  `pillarsPresent: 5`.
- `tsc --noEmit` intentionally NOT run (memory-safety directive for this
  batch) — deferred to the orchestrator's centralized typecheck pass.

## Left alone, with reason

- `server/domains/vote.js` — no backend changes; every defect found was
  frontend glue code targeting the domain with the wrong shape, not a
  backend gap.
- The `council` domain's `vote` macro (`server.js:39921`) — left as-is; it
  is a real, correctly-scoped macro for the (unrelated) `council` lens's
  own debate/vote/simulate-budget workflow. The bug was the `vote` lens
  calling it, not the macro itself being wrong.
