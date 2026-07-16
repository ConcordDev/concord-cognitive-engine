# Law Lens — Capability Map (Wave 2 Rebuild)

> Derived, not asserted. Every macro below was enumerated by grepping
> `server/domains/law.js` (1459 LOC, 35 `registerLensAction("law", …)` calls)
> **plus** 4 inline registrations in `server/server.js` (missed by a
> domain-file-only grep — found during this audit; see "Correction" below).
> Classification follows the Frontend Rebuild Program's distinction:
> **DESIGNED** (bespoke UI wired to the macro's real shape) /
> **GENERIC-STRIP-ONLY** (previously only reachable via an auto-generated
> button array / artifact-transform stub) / **UNSURFACED** (registered, no
> frontend caller) / **world-owned** (n/a for this lens).
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("law"' server/domains/law.js server/server.js`
> (39 total: 35 + 4)

## Correction to the pre-audit brief

The task brief (grepping only `server/domains/law.js`) found 35 macros and
flagged `uspto-patent-search` as the sole zero-caller macro. A full grep
across `server/server.js` inline registrations surfaced **4 more real
macros with zero prior frontend callers**: `law.check-compliance`,
`law.analyze`, `law.draft`, `law.cite` (`server/server.js:40180-40229`,
`// === Law (Legal) ===`). Two of these were load-bearing discoveries:

- **`law.check-compliance`** is a real, server-computed 4-rule keyword
  compliance check. The old page's "Legality Gate Tester" was a
  **client-only reimplementation of 3 of its 4 rules**, calling no macro at
  all — a duplicate, thinner, and honestly-undisclosed copy of logic that
  already existed for real on the backend.
- **`law.analyze`** is a real per-framework (GDPR/CCPA/DMCA/EU AI Act)
  keyword-coverage + risk-scoring macro. The old page's "Legal Frameworks"
  panel showed **4 permanently hardcoded tiles with a fixed
  "compliant"/"review" status that never changed** — a fake-data
  anti-pattern sitting directly next to the real macro that could have
  powered it, and never called it.

Both are now wired for real (see below) — this is exactly the kind of gap
the capability-map step exists to catch, and it changed the rebuild's scope
for the better.

## Backend surface

### Registered macros — `server/domains/law.js` (35)

| Macro | Real result shape (key fields) | Classification |
|---|---|---|
| `caseAnalysis` | `{totalCases, openCases, closedCases, duration, typeBreakdown, outcomes, winRate, judgeStats}` | **DESIGNED** — `CaseAnalytics`, run over the real per-user Case Files list (not a hand-authored JSON artifact — see "What changed") |
| `deadlineTracker` | `{summary, overdue[], urgent[], byCategory, allDeadlines[]}` | **DESIGNED** — `CaseAnalytics`, same real case-file source |
| `billingCalculator` | `{totals, attorneyBreakdown, categoryBreakdown, monthlyBreakdown}` | **DESIGNED** — `BillingCalculator`, an honestly-disclosed ad-hoc session-only calculator |
| `statuteLookup` | `{query, totalMatches, matches[], statuteSummary}` | **DESIGNED** — `LegalTextSearch`, run over text the user pastes (Concord ships no licensed statute corpus — disclosed inline, never faked as a live database) |
| `uspto-patent-search` | `{query, field, patents[], count, totalHits, source}` | **DESIGNED** — `PatentSearch` (**first surface** — zero prior callers anywhere in the repo) |
| `courtlistener-search` | `{query, results[], count, totalHits, authenticatedWithToken, source}` | **DESIGNED** — reused `components/legal/LegalCaseSearch.tsx` verbatim, now also mounted in `law` (previously only mounted in the sibling `legal` lens despite calling the `law` domain macro) |
| `clause-library` | `{categories[], library}` | **DESIGNED** — `LawContracts` clause picker |
| `contract-create` / `-list` / `-detail` / `-update` / `-delete` | contract CRUD | **DESIGNED** — `LawContracts` |
| `clause-add` / `clause-remove` | clause CRUD on a contract | **DESIGNED** — `LawContracts` |
| `contract-review` | `{contractId, riskScore, grade, findings[], clauseCount}` | **DESIGNED** — `LawContracts` |
| `contract-sign` | `{contractId, signatures[], status}` | **DESIGNED** — `LawContracts` |
| `contract-dashboard` | `{total, byStatus, totalValue, expiringSoon, unsigned}` | **DESIGNED** — `LawContracts` header stat strip |
| `contract-version-save` / `-list`, `contract-diff` | version snapshots + real line-level LCS redline | **DESIGNED** — `ContractVersions` (mounted inside `LawContracts`) |
| `clause-extract`, `clause-extract-apply` | deterministic heading/date/amount/obligation parse of pasted contract text | **DESIGNED** — `ClauseExtractor` (mounted inside `LawContracts`) |
| `approval-route` / `-decide` / `-status` | reviewer workflow | **DESIGNED** — `ApprovalWorkflow` (mounted inside `LawContracts`) |
| `obligation-add` / `-complete`, `obligation-tracker` | renewal/expiry/payment task list across all contracts | **DESIGNED** — `ObligationTracker` |
| `contract-esign`, `contract-verify` | SHA-256 signature certificate + tamper-detection verify | **DESIGNED** — `ContractEsign` (mounted inside `LawContracts`) |
| `playbook-list` / `-detail` / `-apply` | pre-approved clause bundles by contract type | **DESIGNED** — `ContractPlaybooks` |
| `repository-search` | full-text search across all of a user's contracts + clauses | **DESIGNED** — `ContractRepositorySearch` |
| `feed` | ingests recent CourtListener opinions as DTUs | **DESIGNED** — `LensFeedButton` + `LensFeedPanel` (Research tab) |

### Inline macros — `server/server.js` (4, `// === Law (Legal) ===`)

| Macro | Real result shape | Classification |
|---|---|---|
| `check-compliance` | `{passed, violations[], checkedAt}` — real 4-rule keyword scan (`params.text` or `artifact.data.body`/title) | **DESIGNED** — `ComplianceScreener` (**first surface**; replaces a client-only 3-rule duplicate that called no macro) |
| `analyze` | `{analysis:[{framework,status,risk,coverage,matchedKeywords,citationCount}], overallRisk, totalDrafts, totalCitations}` — real per-framework keyword-coverage scoring | **DESIGNED** — `FrameworkCoverage` (**first surface**; replaces 4 hardcoded, permanently-fixed-status tiles) |
| `draft` | appends `{id,title,body,version,status}` to a **real persisted artifact's** `data.drafts[]` | **UNSURFACED** — see disposition below |
| `cite` | appends `{id,source,text,relevance}` to a **real persisted artifact's** `data.citations[]` | **UNSURFACED** — see disposition below |

`draft`/`cite` mutate a real artifact in place — they only persist when
called **id-scoped** (`useRunArtifact('law').mutateAsync({id, action,
params})` → `POST /api/lens/law/:id/run` → `lens.run`, which fetches the
live `STATE.lensArtifacts` object and passes the mutable reference to the
handler). Called generically (`lensRun('law','draft',{...})`, the pattern
used for every macro above), the mutation would land on a throwaway
`{id:null}` virtual artifact and be discarded — so these two genuinely need
a per-case UI (attach drafts/citations to a specific Case File), which this
rebuild scoped out; see the reference-parity checklist below for the exact
disposition.

### Cross-mountable panel — none

Unlike `finance`, `law` has no `lib/panel-registry.ts` cross-mount entry.

## `law` vs `legal` — an honest disclosure (same pattern as the `lattice`
## naming-collision precedent from Wave 1)

There are **two separate, unrelated lenses** whose names are easy to
conflate:

- **`law`** (this lens) — legal **research** (case law + patents) +
  **compliance screening** + a **contract-lifecycle** substrate
  (Ironclad/LegalZoom-shape: draft → clause → review → approve → sign →
  track). Backed by `server/domains/law.js` + 4 inline `server.js` macros.
- **`legal`** (`app/lenses/legal/page.tsx` + `server/domains/legal.js`) —
  a **law-FIRM practice-management** tool (Clio-shape): case tracker,
  intake forms, billing **reports**, conflict checks. A completely
  different domain file, completely different macro namespace.

They are **adjacent but distinct** — this rebuild does not merge them, and
does not silently ignore the overlap. The one genuine crossover is
`LegalCaseSearch.tsx`: a real, well-built CourtListener search component
that calls the **`law`** domain's `courtlistener-search` macro but was
previously mounted only in the **`legal`** lens. This rebuild reuses it
verbatim (not modified — `components/legal/LegalCaseSearch.tsx` is
unchanged) and mounts it in `law` too, where case-law search actually
belongs. The `legal` lens keeps its own mount of the same component
unchanged — nothing there regresses.

## Reference-parity checklist (step 1.5)

**(a) Reference apps.** Three real, inspectable analogs — one per
sub-capability, chosen for being either the actual data source's own
product or a free/inspectable peer (never a paywalled tool this agent
cannot actually see the inside of):

- **Case-law research** → **CourtListener's own public search UX**
  (courtlistener.com — the honest analog, since it's literally the data
  source this lens queries; Westlaw/Lexis+ are paywalled proprietary tools
  and are explicitly *not* used as the bar here).
- **Patent research** → **USPTO Patent Public Search** (uspto.gov — the
  official free tool; Google Patents cited only for what a *broader*
  aggregator additionally offers, since Concord's `uspto-patent-search`
  macro is USPTO-only by design).
- **Contract lifecycle** → **Ironclad** (the CLM category leader; features
  below researched via ironcladapp.com + G2 + Juro's comparison, current
  as of this rebuild).

**(b) Parity target, stated explicitly.** *"The only difference should be
data-source breadth/scale, nothing else in the core interaction model"* —
CourtListener's own public corpus vs. a paywalled aggregator's proprietary
editorial layer; USPTO's US-only index vs. Google Patents' 120M+
multi-jurisdiction index; Concord's self-contained contract substrate vs.
Ironclad's enterprise integrations (Salesforce/DocuSign/Slack) and
LLM-based clause analysis vs. Concord's deterministic parser. Within the
interaction model itself (search → filter → inspect → cite/save; draft →
review → approve → sign → track), parity is the target.

**(c)/(d) Checklist, researched, every item dispositioned:**

### Case-law research (vs. CourtListener)
| Item | Disposition |
|---|---|
| Keyword/boolean search across opinions | **ALREADY REAL** — `courtlistener-search`, `LegalCaseSearch` |
| Court + filed-after/before filters | **ALREADY REAL** — `LegalCaseSearch` filter chips |
| Case name, citation, docket, court, judge, precedential status | **ALREADY REAL** — `LegalCaseSearch` result cards |
| Snippet with query-term highlighting | **ALREADY REAL** — `LegalCaseSearch` |
| Save/cite a result as a DTU | **ALREADY REAL** — `SaveAsDtuButton` on every result |
| ~~Semantic / natural-language search~~ | GENUINELY MISSING → **CLOSED (2026-07-12, `4f905b8c`)** — `law.courtlistener-search` now accepts `params.semantic: true` and forwards CourtListener's real v4 `semantic=true` GET query param (additive: omitted entirely when not requested, so pre-existing keyword calls are byte-identical). **Source for the param name** (courtlistener.com/free.law were network-blocked in this environment, matching the earlier RECAP unit's experience — verified instead against CourtListener's own open-source Django code, `github.com/freelawproject/courtlistener`): `cl/search/forms.py`'s `SearchForm.semantic` `BooleanField` (the form backing the exact `SearchV4ViewSet.list` GET view this macro already calls), `cl/search/api_views.py`'s type-restriction check ("Semantic search is only supported for type 'o'" — satisfied by construction since this macro hardcodes `type: "o"`), and `cl/search/api_serializers.py`'s `MainDocumentMetaDataSerializer.get_score()`, which swaps in `SemanticSearchScoreSerializer` (`bm25` + `semantic` float fields) exactly when `request.GET.get("semantic")` is truthy — corroborated by two independent Free Law Project blog posts ("Semantic Search API Now Live!", 2025-11-05; "Semantic Search Is Now on CourtListener", 2026-05-04) surfaced via web search. `LegalCaseSearch.tsx` (shared by both `law` and `legal` lenses) got a real Keyword/Semantic segmented toggle next to the search box — not decorative: it swaps the placeholder to a natural-language prompt, sends `semantic: true` only when active, and renders a per-result `NN% match` badge from `meta.score.semantic` only when CourtListener actually returned one (never fabricated for keyword-mode results). Backend contract tests: `server/tests/law-real-data-domain-parity.test.js` (`describe("semantic mode")`, 4 new tests — byte-identical keyword request, real `semantic=true` param, string-`"true"` coercion, defensive `meta.score` parsing for both modes + the no-`meta` degrade case). Frontend tests: `concord-frontend/tests/components/LegalCaseSearch.test.tsx` (`describe('semantic search toggle')`, 3 new tests). |
| Citation graph ("who cites this opinion") | **GENUINELY MISSING** — needs CourtListener's `cited_by` data via a separate call; `LegalCaseSearch.tsx`'s own header comment already disclosed this as a known follow-up before this rebuild. Flagged future. |
| RECAP/PACER docket search | **GENUINELY MISSING** — the macro only searches opinions (`type=o`), never PACER dockets. Flagged future — a real, separately-scoped macro + UI (RECAP is a distinct CourtListener product surface). |
| Search alerts / docket alerts / citation alerts | ~~**GENUINELY MISSING**~~ **CLOSED (2026-07-16, `e0cc274a`)** — new `search-alert-add`/`list`/`remove`/`check` macros. `search-alert-check` calls the exact same `courtlistener-search`/`recap-docket-search` handler functions in-process (refactored from anonymous arrow functions into named consts specifically so this direct call is possible — zero behavior change to the two existing macros), diffing the fresh result-id set against the prior successful check's `lastSeenResultIds`. A failed underlying search (network down, rate limit) returns a real `{ok:false, error}` and never touches the stored baseline — a failed check must never read as "checked, nothing new." No heartbeat was wired: this lens has no notification/delivery channel (no push/email/toast), so a silent background sweep would consume the "new" flag before the user ever saw it, which is worse than no automation — left explicitly manual "Check now" only, with `SearchAlertsPanel.tsx`'s copy saying so verbatim. No fabricated "citation" alert type: CourtListener citation lookup already IS case-law opinion search with a citation string as the query, so a separate type would silently alias `case_law` — watching a citation today is a `case_law` alert whose query is the citation string. |

### Patent research (vs. USPTO Patent Public Search)
| Item | Disposition |
|---|---|
| Keyword search by title/abstract/inventor/assignee | **ALREADY REAL** (this rebuild) — `PatentSearch`, first surface for `uspto-patent-search` |
| Grant date, inventors, assignees | **ALREADY REAL** — `PatentSearch` result cards |
| Save as DTU + link to full record | **ALREADY REAL** — `SaveAsDtuButton` + Google Patents link-out (USPTO PatentsView returns no direct public URL, so the link-out targets a safe patent-number search, never a guessed/possibly-404 direct URL) |
| Combined multi-field boolean query builder | **GENUINELY MISSING** — the macro accepts one `field` at a time, not a combinator. Flagged future (backend macro extension). |
| Full claims text / prosecution history | **GENUINELY MISSING** — PatentsView query here only requests title/abstract/date/inventors/assignees, not claims or file-history fields. Flagged future. |
| Legal status (active/expired/litigated) | **GENUINELY MISSING** — not in the current field set. Flagged future. |
| Foreign patent coverage (EPO/WIPO/etc.) | **Honest relabel, not a gap** — USPTO Patent Public Search is deliberately US-only; Concord's macro matches that reference exactly. Google Patents' broader index is a different, larger reference this lens doesn't claim to match. |

### Contract lifecycle (vs. Ironclad)
| Item | Disposition |
|---|---|
| Centralized repository + full-text search | **ALREADY REAL** — `LawContracts` + `ContractRepositorySearch` |
| Clause library | **ALREADY REAL** — `clause-library`, `LawContracts` picker |
| Automated clause extraction from uploaded contracts | **ALREADY REAL, honestly differentiated** — Ironclad's "Jurist AI" is LLM-based; Concord's `clause-extract` is a **deterministic** heading/date/amount/obligation parser (reproducible, no LLM cost/latency/hallucination risk). Disclosed as such in `ClauseExtractor`'s own header comment — not claimed as AI. |
| Visual workflow/approval routing | **ALREADY REAL** — `approval-route/-decide/-status`, `ApprovalWorkflow` |
| Risk assessment / scoring | **ALREADY REAL** — `contract-review` (findings + riskScore + grade) |
| Renewal/expiry/payment obligation tracking | **ALREADY REAL** — `obligation-tracker`, `ObligationTracker` |
| E-signature | **ALREADY REAL, narrower scope disclosed** — `contract-esign`/`contract-verify` produce a real SHA-256 signature certificate + tamper-detection verify (arguably a stronger audit trail than a click-to-sign flow), but this is **not** a legally-compliant consumer e-signature service (no ESIGN/UETA-certified identity verification, no DocuSign-class integration) — disclosed in `ContractEsign`'s header comment, unchanged by this rebuild. |
| Version history / redline diff | **ALREADY REAL** — `contract-diff` (real line-level LCS), `ContractVersions` |
| Playbook/template-driven drafting | **ALREADY REAL** — `playbook-*`, `ContractPlaybooks` |
| Analytics dashboard (counts/value/expiring/unsigned) | **ALREADY REAL, core numbers only** — `contract-dashboard`. Deeper trend analytics (cycle-time-to-signature, renewal-rate-over-time, spend-by-counterparty trend lines) is **GENUINELY MISSING** — flagged future. |
| Draft + citation logging per contract/matter | **BACKEND-CAPABLE-BUT-UNSURFACED** — `law.draft` / `law.cite` exist and mutate a real persisted artifact, but need per-artifact (id-scoped) wiring this rebuild did not build. Flagged as a scoped future task: a "Drafts & Citations" sub-panel on each `CaseFiles` entry using `useRunArtifact('law').mutateAsync({id, action:'draft'\|'cite', params})` — ~150-200 LOC, no backend work needed. Once wired, it would also make `FrameworkCoverage`'s `citationCount`/`documented` status meaningful per-case (today `FrameworkCoverage` always passes `citations:[] / drafts:[]` since there is no real per-case store to read them from yet — disclosed in the component's own header comment). |
| Third-party integrations (Salesforce/DocuSign/Slack/etc.) | **Out of scope, not a gap to close here** — Concord's contract substrate is intentionally self-contained; connector work is tracked at the platform level (`docs/CONNECTORS_GO_LIVE.md`'s Track C), not per-lens. |
| Real-time multi-party collaborative redlining (Word/Google Docs plugin) | **GENUINELY MISSING**, large scope — flagged future, not attempted here. |

### Compliance + case tooling (no single named reference product — these are
### Concord-native combinations of real macros; dispositioned against "does
### every registered macro have a real, honest UI" rather than an external app)
| Item | Disposition |
|---|---|
| Keyword compliance screening | **ALREADY REAL** (this rebuild) — `check-compliance`, `ComplianceScreener`, first surface |
| Per-framework coverage/risk scoring | **ALREADY REAL** (this rebuild) — `analyze`, `FrameworkCoverage`, first surface |
| Case win-rate / duration / judge analytics | **ALREADY REAL** (this rebuild) — `caseAnalysis`, `CaseAnalytics`, run over real Case Files (previously required a hand-authored JSON artifact with no UI to produce one) |
| Deadline urgency triage | **ALREADY REAL** (this rebuild) — `deadlineTracker`, `CaseAnalytics`, same real source |
| Ad-hoc billing calculator | **ALREADY REAL** (this rebuild), honestly scoped — `billingCalculator`, `BillingCalculator`; disclosed as a session-only calculator, not a persistent time-tracking ledger (that functionality, if it exists at all, belongs to the separate `legal` practice-management lens) |
| Statute/regulation search over a licensed corpus | **Honest relabel, not faked** — Concord ships no licensed statute database; `statuteLookup`/`LegalTextSearch` searches exactly the text the user pastes, disclosed inline, never presented as a live corpus |

## What the rebuild changed (honest-by-construction)

**Removed fabricated/dead surfaces from the old 686-line page:**
1. **4 hardcoded "legalFrameworks" tiles** — a static array with a
   permanently-fixed `"compliant"`/`"review"` status that never changed no
   matter what, sitting directly next to a real macro (`law.analyze`) that
   could compute the real thing and was never called. Replaced by
   `FrameworkCoverage`.
2. **Client-only "Legality Gate Tester"** — reimplemented 3 of the real
   `law.check-compliance` macro's 4 rules in plain client JS, calling no
   macro. Replaced by `ComplianceScreener`, wired to the real macro (which
   also has a 4th rule — biometric+mass-surveillance — the old duplicate
   omitted).
3. **`useRealtimeLens('law')` + `LiveIndicator` + `RealtimeDataPanel`** —
   dead chrome. `DOMAIN_EVENTS` in `hooks/useRealtimeLens.ts` has no `law`
   key (only `legal`), so `isLive` was permanently `false` and
   `latestData` permanently `null` — a decorative live-indicator that could
   never actually go live.
4. **The raw 4-button "Legal Analysis" strip** — required an existing,
   separately-created JSON `artifact` id via `useRunArtifact`, with no UI
   to ever create one; a dead strip in practice. Replaced by `CaseAnalytics`
   (running the same `caseAnalysis`/`deadlineTracker` macros over real,
   already-persisted Case Files), `LegalTextSearch` (running `statuteLookup`
   over pasted text), and `BillingCalculator` (running `billingCalculator`
   over ephemeral session entries).

**Retired generic scaffold:** `ManifestActionBar`, `AutoActionStrip`,
`RecentMineCard`, `CrossLensRecentsPanel`, `UniversalActions`,
`LensFeaturePanel`, `SessionRail`, `ConnectiveTissueBar` — replaced with a
designed, keyboard-navigable (1–4) workspace grouped by real workflow
(Research / Contracts / Case Files / Analytics & Tools).

**New macro surfaces (first frontend callers, ever):**
`uspto-patent-search`, `check-compliance`, `analyze`.

**Coverage metric (DESIGNED only):** 35 of 39 registered `law` macros are
now surfaced by a deliberate design decision. The remaining 4
(`law.draft`, `law.cite` — unsurfaced with an explicit scoped-future
disposition above) are honestly disclosed, not silently dropped.

## Verification (2026-07-09)

- `cd concord-frontend && npx eslint app/lenses/law/page.tsx components/law/*.tsx components/law/*.ts` → clean, 0 errors/warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` → 0 errors (repo-wide clean; no baseline to compare against since the whole repo compiles clean).
- `cd concord-frontend && npx vitest run tests/components/LegalCaseSearch.test.tsx` → 7/7 passing (unmodified component, reused as-is; sanity-checked since `law` now depends on it too).
- `cd concord-frontend && npx vitest run tests/lib/lenses/manifest.test.ts` → 24/24 passing (no manifest drift from this rebuild).
- No existing test file targeted `app/lenses/law/page.tsx` or `components/law/*` before this rebuild (`grep -rl "lenses/law/page\|LawLensPage\|from '@/components/law/" concord-frontend/tests` → no matches) — nothing to fix, nothing broken.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}` (`narrative-walk`, `ux-suite` only) — `law` stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest` → `law` row: `tier: "polished"`, `isGenericScaffold: false`, `usesGenericBody: false`, `importsGenericTrio: false`, `hasMacroButtonWall: false`, `divAsButtons: 0`, `inlineHex: 0`, `antiPatterns: 0`, `pillarsPresent: 5/5`. Generic-scaffold count dropped from 50 → 49 lenses repo-wide (this fix). `audit/ux-polish-honest.json` reverted after the run per the transient-artifact convention (CLAUDE.md §6).
- Manual grep for `<div` + `onClick` without `role`/`tabIndex`/`onKeyDown` across every touched file → 0 real violations (one false-positive from a crude single-line regex was checked against the actual, bracket-counting-aware grader logic and confirmed clean: the flagged div genuinely carries `role="button"`, `tabIndex={0}`, and a real `onKeyDown` handler a few lines further down than the naive regex's line-based match window).

## Files touched

- `concord-frontend/app/lenses/law/page.tsx` (full rewrite)
- `concord-frontend/components/law/CaseFiles.tsx` (new)
- `concord-frontend/components/law/case-types.ts` (new — shared types/constants)
- `concord-frontend/components/law/CaseAnalytics.tsx` (new)
- `concord-frontend/components/law/LegalTextSearch.tsx` (new)
- `concord-frontend/components/law/BillingCalculator.tsx` (new)
- `concord-frontend/components/law/ComplianceScreener.tsx` (new)
- `concord-frontend/components/law/FrameworkCoverage.tsx` (new)
- `concord-frontend/components/law/PatentSearch.tsx` (new)
- Reused unchanged: `components/law/LawContracts.tsx`, `ContractPlaybooks.tsx`,
  `ObligationTracker.tsx`, `ContractRepositorySearch.tsx`, `LawFeed.tsx`,
  `ContractVersions.tsx`, `ClauseExtractor.tsx`, `ContractEsign.tsx`,
  `ApprovalWorkflow.tsx`, and (read-only, cross-lens) `components/legal/LegalCaseSearch.tsx`.
