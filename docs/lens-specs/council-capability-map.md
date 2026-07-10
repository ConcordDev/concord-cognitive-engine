# Council Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro counts:
> `grep -c 'registerLensAction("council"' server/domains/council.js` → 28
> `grep -c 'registerLensAction("council"' server/server.js` → 4 (`debate`, `vote`, `simulate-budget`, `audit`)
> `grep -c 'register("council"' server/server.js` → 8 (`understanding_for_proposal`, `evaluate`, `voices`, `reviewGlobal`, `weeklyDebateTick`, `vote`, `tally`, `credibility`)
>
> Total addressable `council.*` surface: **40 macro registrations** across
> **39 distinct action names** — `council.vote` is registered twice: once via
> `register()` into the `MACROS` map (`server/server.js:35754` — a DTU-approval
> vote keyed by `dtuId`/`persona`, feeding `council.tally`) and once via
> `registerLensAction()` (`server/server.js:39886` — a generic per-artifact
> ballot accumulator: `{voterId, choice, weight, rationale}` pushed onto
> `artifact.data.votes`). Verified in code: `/api/lens/:domain/:id/run` (and
> the internal `_dispatchLensRunForTest`) both prefer `LENS_ACTIONS` over
> `MACROS` (comment at `server/server.js:39390-39392`), so the
> `registerLensAction` copy wins on that path and the `register()` copy is
> **unreachable through the lens dispatcher** — not a redundant duplicate of
> the same feature (they're genuinely different: DTU global-review voting vs.
> generic-artifact ballot voting), just a name collision. Left as-is: renaming
> or removing a macro registration is outside this rebuild's surgical scope
> and risks breaking a caller that invokes `runMacro("council","vote",...)`
> directly, bypassing the lens dispatcher.
>
> A **separate, non-macro REST family** also exists at `/api/council/*`
> (`voices`, `voices/evaluate`, `propose-promotion`, `vote`, `proposals`,
> `theater`, `debate`, `deliberate`, `sessions`) backing `CouncilVoices.tsx`,
> `CouncilTheaterPanel.tsx`, `GovernanceVotingPanel.tsx`, and `BrainCouncil.tsx`
> (the last is mounted on the *home* page, not this lens — out of scope).
> All confirmed real via direct `fetch`/`api.get`/`api.post` calls, no mocks.
>
> `server/domains/realm-council.js` registers a **different domain**,
> `realm_council` (kingdom/realm decree petitions — open_session/
> submit_petition/cast_vote/tally/lobby), confirmed by grep to have **zero
> callers** anywhere in this lens's frontend — a separate substrate,
> correctly left untouched.

## Reference apps

This is a governance / deliberation / board-management domain. Two distinct
real-world analogs map onto distinct parts of the surface:

1. **Loomio** (collaborative consent-based governance) — proposal lifecycle
   (draft → discussion → voting → decided), threaded discussion, amendments,
   multiple voting methods (majority / supermajority / ranked-choice /
   approval / consent-based-with-blocks), delegation.
2. **Board-management software** in the shape of Convene / BoardEffect /
   OnBoard — meeting agendas with time-boxed items, attendee RSVP/check-in,
   quorum enforcement gating the vote, document packets ("board books"),
   minutes generation, action items with owners/due-dates/carry-forward,
   a searchable decision archive.

**Parity target, stated explicitly:** the only difference between this lens
and a real Loomio+Convene composite should be catalog/organization scale
(how many proposals, meetings, members exist) — not missing governance
mechanics. Content fills via user authorship by design (a workspace tool,
not a content site), so this scores FEATURE parity, not content volume.

## Capability checklist

| Capability | Disposition | Notes |
|---|---|---|
| Proposal lifecycle (draft→discussion→voting→decided/implemented/rejected) + type taxonomy | ALREADY REAL | Proposals tab, backed by `useLensData('council','proposal')` — real per-user server-side persistence |
| Threaded discussion + amendments (propose/accept) | ALREADY REAL | Proposal detail view |
| 5 voting methods declared (majority/supermajority/ranked-choice/approval/consent) + 6-point vote scale with block | ALREADY REAL | `VOTING_METHODS`/`VOTE_OPTIONS`; per-stakeholder vote casting persists into `Proposal.votes` |
| Vote delegation | ALREADY REAL | Stakeholders tab — `handleDelegate` |
| Ranked-choice **actual tabulation** (instant-runoff, round-by-round eliminate-and-redistribute) | ALREADY REAL | `council.ranked-choice-tabulate` macro + UI in `DecisionArchive.tsx` |
| Meeting agenda builder + scheduling (timed items, presenter, order, status) | ALREADY REAL | `council.meeting-*`/`council.agenda-*` macros + `MeetingsWorkspace.tsx` (897 LOC, real `lensRun` calls, pinned by `tests/council-lens-states.test.tsx`) |
| Attendee RSVP + check-in | ALREADY REAL | `council.attendee-*` macros, same component |
| Quorum enforcement (blocks tally below threshold) | ALREADY REAL | `council.quorum-check`, same component |
| Document packet / board book | ALREADY REAL | `council.packet-add`/`packet-remove`, same component |
| Action-item tracking from minutes (owner, due date, carry-forward) | ALREADY REAL | `council.action-*` incl. `action-carry-forward`, same component |
| Decision archive + full-text search | ALREADY REAL | `council.decision-archive`/`decision-search`/`decision-delete` + `DecisionArchive.tsx` (629 LOC) |
| Meeting minutes auto-generation | ALREADY REAL, but only reachable via a broken duplicate panel — **now fixed** | `council.generateMinutes`; the correct standing UI is `CouncilActionPanel.tsx` |
| AI-scored deliberation (per-voice weighted consensus) | ALREADY REAL, but only reachable via a broken duplicate panel — **now fixed** | `council.deliberate`; real UI is `CouncilActionPanel.tsx` |
| Vote-count / pass-threshold analysis | ALREADY REAL, but only reachable via a broken duplicate panel — **now fixed** | `council.voteCount`; real UI is `CouncilActionPanel.tsx` |
| Structured conflict resolution (parties/positions/priorities → suggested approach) | ALREADY REAL, but only reachable via a broken duplicate panel — **now fixed** | `council.conflictResolution`; real UI is `CouncilActionPanel.tsx` |
| Turn-taking debate arena (points/counterpoints/motions, speaking queue) | ALREADY REAL | Debates tab, `useLensData('council','debate')` |
| Real debate synthesis (stance breakdown + consensus % from actual turns) | BACKEND-CAPABLE-BUT-UNSURFACED → **now wired** | `council.debate` (`server/server.js:39862`) was never called; frontend's "Synthesize" called the wrong macro and "Conclude" stamped a fabricated placeholder. Fixed — see below. |
| Multi-persona AI council theater (scheduled streaming deliberations) | ALREADY REAL | `CouncilTheaterPanel.tsx` → `/api/council/theater` |
| DAO+IBIS governance workbench (deliberate/vote/minutes/resolve + mint session DTU / DM brief / publish public minutes / draft amendment via agent) | ALREADY REAL | `CouncilActionPanel.tsx` — was already correctly wired, but orphaned behind a redundant broken in-page duplicate; duplicate removed so this component now stands as the sole, working surface for these four macros |
| Governance/emergent proposal voting (separate REST family) | ALREADY REAL | `GovernanceVotingPanel.tsx` → `/api/council/propose-promotion`, `/vote`, `/proposals` |
| Council-voices deterministic per-voice evaluation | ALREADY REAL | `CouncilVoices.tsx` → `/api/council/voices`, `/api/council/voices/evaluate` |
| Budget modeler (line items, revenue/expense, approval workflow, category allocation viz) | ALREADY REAL | Budget tab, `useLensData('council','budget')` |
| Budget **variance simulation** (low/high/expected projection, over-budget risk, confidence) | BACKEND-CAPABLE-BUT-UNSURFACED | `council.simulate-budget` exists (variance-weighted low/high/expected per line item + aggregate risk) but has zero frontend caller. Disposition: **scoped future build task** — a "Run Simulation" action on the Budget tab calling `simulate-budget` with the current `budgetItems`, rendering a projected range above the existing summary cards. Deferred: additive net-new UI, not a fix to something broken; this pass's budget went to the confirmed-broken items that block real usage today. |
| Audit trail — derived process-completeness/vote-timeline/debate-turn trail from a real artifact | BACKEND-CAPABLE-BUT-UNSURFACED | `council.audit` computes a real derived trail (`totalVotes`, `uniqueVoters`, `choiceTally`, `debateTurns`, `processCompleteness`) but is never called. The Audit tab instead shows a manually-logged event list (`addAuditEntry` calls threaded through every UI action) — real, honestly-persisted data, just a shallower parallel mechanism, not fake. Disposition: **honest relabel** — the tab is legitimate and useful as-is; a future pass could add `council.audit`'s derived trail as a secondary "Process Completeness" card on a selected proposal. |
| Committee creation + chair/member management, incl. editable description | ALREADY REAL | Stakeholders tab, `useLensData('council','committee')` |
| CSV export of the audit log | ALREADY REAL | `handleExportAudit` |

## What was genuinely fake/generic (confirmed)

Three real, confirmed defects. This lens is **not** a scaffold — it is one of
the largest, most carefully built lenses in the tree (8 tabs, ~3,000+ lines,
5 dedicated bespoke components, real code comments documenting prior honesty
fixes like `council.js`'s `_looksLikeRealProposal` guard). The defects below
are the genuine exceptions, not the pattern:

1. **The only UI surface for `deliberate`/`voteCount`/`generateMinutes`/
   `conflictResolution` was structurally trapped inside a modal and
   unreachable in normal use.** The "Council Analysis Engine" panel (buttons
   + result cards for all four macros), a `<UniversalActions>` bar, and a
   `<RealtimeDataPanel>` were JSX siblings of the "Start Debate" modal's
   *content*, but all nested **inside** `{showCreateDebate && (<div
   className={ds.modalBackdrop}>...)}` — and `ds.modalBackdrop` is
   `'fixed inset-0 bg-black/60 backdrop-blur-sm z-50'`
   (`lib/design-system.ts:141`). Concretely: the panel only rendered while
   the "Start Debate" modal's full-screen backdrop was mounted, stacked
   awkwardly alongside the actual debate-creation dialog in the same fixed
   overlay — a user could never reach these four macros through normal
   navigation. This duplicate panel was also inferior to, and made entirely
   redundant by, `CouncilActionPanel.tsx` — a separately, correctly, and
   unconditionally-mounted component at the bottom of the same page that
   already surfaces the identical four macros via the intended
   "virtual-artifact" convention documented in
   `server/domains/council.js:40-50` (no dependency on a persisted Proposal
   artifact existing first), with real busy/success/error states per action
   plus bonus mint/DM/publish/amend workflows.
2. **The header's standalone "Generate Minutes" button always failed.** It
   called `runArtifact.mutate({ id: 'council', action: 'generateMinutes',
   params: { debates, proposals } })` — `'council'` is a literal string, not
   a real `lensArtifact` id. `lens.run`'s handler (`server/server.js:38269`)
   does `STATE.lensArtifacts.get(id)` and returns `{ ok: false, error: "not
   found" }` when the id doesn't resolve — which always happened here,
   silently, since the click handler had no error surfacing. Even had the id
   been real, `{ debates, proposals }` matches neither of `generateMinutes`'s
   two accepted input shapes, so it would have produced an empty minutes doc
   regardless.
3. **The Debates tab's "Synthesize" button called the wrong macro, and
   "Conclude" fabricated a placeholder.** `handleGenerateSynthesis` called
   `council.deliberate` (a Proposal-text analyzer with no concept of debate
   turns) instead of `council.debate` (the real turn-taking stance/consensus
   engine at `server/server.js:39862`) — the wrong macro's result ("Submit a
   proposal for council deliberation.") was discarded, unused. Separately,
   `handleConcludeDebate` unconditionally set `synthesis: 'Synthesis to be
   generated...'` — a fabricated string rendered in the UI as if it were the
   debate's real, computed synthesis, that never resolved into anything real.

**A fourth, smaller defect (committee "edit" no-op) was found already fixed
on disk at audit time**, not by this pass: `updateCommitteeItem(c.id, {
data: { ...c, description: c.description } })` — writing back the identical
value, a no-op disguised as a working edit affordance. The fix present in
the working tree (a `window.prompt`-based real edit, gated on the value
actually changing) matches this exact defect class and was verified correct
and left untouched — it is not this pass's work, but it is confirmed real
and consistent with the "honest by construction" bar, so it was kept as-is
rather than re-touched.

## What changed

- **`concord-frontend/app/lenses/council/page.tsx`** (net −472 lines):
  - Removed the entire duplicate, structurally-broken "Council Analysis
    Engine" panel (the four-macro button grid + result cards) along with its
    now-redundant state (`councilActionRunning`, `deliberateResult`,
    `voteCountResult`, `minutesResult`, `conflictResult`, `hasRealProposal`,
    `handleCouncilAction`) — this functionality already exists, correctly
    wired and unconditionally mounted, in `CouncilActionPanel.tsx`.
  - Closed the "Start Debate" modal at its own boundary (right after its own
    content) instead of leaving the rest of the page's JSX nested inside its
    `fixed inset-0` backdrop.
  - Moved the live realtime-insights panel (`<RealtimeDataPanel>`, gated on
    `realtimeData` existing — honest, no fabricated fallback) out of the
    broken nesting so it renders unconditionally as a normal top-level
    section.
  - Removed the redundant `<UniversalActions>` generic AI action bar
    (analyze/generate/suggest) that was trapped in the same broken nesting —
    this page already carries substantial bespoke depth (`CouncilActionPanel`
    + `AutoActionStrip` already cover the "more actions" role); a second
    generic AI-action strip added noise without adding a real capability.
  - Removed the header's broken "Generate Minutes" button (fake artifact id,
    always failed) — the equivalent, correctly-wired "Minutes" action already
    exists in `CouncilActionPanel.tsx`.
  - Fixed `handleGenerateSynthesis` to call the real `council.debate` macro
    (mapping each debate point's `type` — point/counterpoint/motion — to a
    `stance` of support/oppose/procedural for the turn), consume the real
    returned `synthesis`, and persist it onto the debate item. Added a
    per-debate `synthesizingDebateId` pending state with a distinct spinner +
    "Synthesizing…" label on the specific triggering button, and disabled
    the button (with a tooltip) when a debate has zero points to synthesize
    from.
  - Fixed `handleConcludeDebate` to stop fabricating a placeholder synthesis
    string — concluding a debate with no prior "Synthesize" run now honestly
    leaves `synthesis` unset (the UI's existing `{d.synthesis && (...)}`
    guard already renders nothing in that case) instead of a fake "to be
    generated..." string that never resolved.
  - Removed now-dead icon imports (`FileDown`, `HeartHandshake as
    HandshakeIcon`) and the `UniversalActions` import.
- **Left alone (already real, verified in code):** `MeetingsWorkspace.tsx`,
  `DecisionArchive.tsx`, `CouncilActionPanel.tsx`, `CouncilVoices.tsx`,
  `CouncilTheaterPanel.tsx`, `GovernanceVotingPanel.tsx`, the Proposals/
  Voting/Budget/Audit/Stakeholders tabs (incl. the already-fixed committee
  edit affordance), and all 40 backend macro registrations in
  `server/domains/council.js`/`server/server.js`. `server/domains/
  realm-council.js` confirmed uncalled by this lens and untouched.
- **Not built this pass (see checklist dispositions above for why):**
  a "Run Simulation" UI for `council.simulate-budget`, and a secondary
  `council.audit`-derived "Process Completeness" card. Both are additive,
  non-broken, scoped future work — not fabricated, not silently dropped.

## Verification

- `cd concord-frontend && npx eslint app/lenses/council/page.tsx` — clean, exit 0, no output (0 errors, 0 warnings).
- TypeScript: project-wide `tsc --noEmit` was intentionally NOT run here (per
  orchestrator instruction, to avoid two concurrent heavy typecheck processes
  in a shared Wave-3 working tree); the edited regions were re-read carefully
  for type correctness (the `useRunArtifact` mutation's `{ ok: boolean;
  result: unknown }` return shape, the debate-point→turn mapping, and every
  removed state/handler's remaining references checked to be zero — see the
  removals above).
- `node scripts/verify-lens-backends.mjs` — `{"verdicts":{"WIRED":258,"NO-BACKEND-CALL":2},"total":260}`; the only two `NO-BACKEND-CALL` lenses are `narrative-walk` and `ux-suite` (both by-design) — `council` is in the WIRED set, 0 broken.
- `node scripts/grade-ux-polish.mjs --honest` — `council`: `"tier": "polished"`, `"isGenericScaffold": false`, `"usesGenericBody": false`, `"importsGenericTrio": false`, `bespokeComponentLoc: 2386` across 7 files.
- `concord-frontend/tests/council-lens-states.test.tsx` (the only existing council test file) exercises `MeetingsWorkspace` only — untouched by this change, no modifications needed.
- Transient regenerated grader artifacts (`audit/ux-polish-honest.json`,
  `audit/ux-polish-honest-gaps.md`) were reverted via `git checkout --` after
  verification; `git status` confirms only
  `concord-frontend/app/lenses/council/page.tsx` and this doc are the
  council-scoped changes (other modified files visible in the shared working
  tree belong to other concurrent Wave-3 agents' in-flight lenses, not
  touched here).
