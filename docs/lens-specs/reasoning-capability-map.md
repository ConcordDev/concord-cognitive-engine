# Reasoning Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/reasoning.js` in full, then cross-checked against every
> `register(...)`/`registerLensAction(...)` call naming domain `"reasoning"`
> anywhere in `server/server.js` (there are two more clusters there, both
> confirmed real — see "Three separate reasoning substrates" below).
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("reasoning"' server/domains/reasoning.js server/server.js`
> `grep -n 'register("reasoning"' server/server.js server/domains/reasoning.js`

## Scope

`app/lenses/reasoning/` has two routes. Both are in scope and both were
read in full:

- `app/lenses/reasoning/page.tsx` (2,600+ LOC) — the main lens: a 6-tab
  argument-analysis workspace (Arguments / Premises / Evidence / Fallacies /
  Templates / Analysis), mounting `ArgumentMapStudio` (persistent Kialo-style
  argument maps), `ArgumentWorkbench` (stateless one-shot argument analysis),
  a "Chain Builder" (linear premise→step→conclusion reasoning traces), and
  `ReasoningArxiv`.
- `app/lenses/reasoning/traces/page.tsx` — a **separate, genuinely distinct
  surface**: a read-only watcher/dashboard over the High-Level-Reasoning
  engine (`server/emergent/hlr-engine.js`, 7 reasoning modes via `runHLR`),
  not a tab or component of the main page. It is intentionally
  create/update/delete-free (a trace is an immutable record of a completed
  reasoning pass). It was already fully, honestly wired at the start of this
  audit — see "Left alone" below.

## Three separate reasoning substrates (this was the source of most defects)

The domain name `"reasoning"` is shared by three genuinely distinct backend
systems, registered in three different places:

1. **`server/domains/reasoning.js` default export** (`registerLensAction`,
   → `LENS_ACTIONS`) — stateless analysis engines (`logicValidate`,
   `argumentMap`, `fallacyDetect`, `premiseExtract`) + the persistent
   Kialo-style argument-map substrate (`map-*`/`node-*`/`evidence-*`/
   `collaborator-*`/`scheme-*`, keyed in `STATE.reasoningLens`).
2. **`server/domains/reasoning.js` `registerReasoningTraceMacros`**
   (`register`, → `MACROS`) — `traces`/`trace`/`run`, thin delegations to
   the HLR engine. Backs the `traces` sub-route.
3. **`server/server.js` ~L66965 "REASONING CHAINS ENGINE"** (`register`,
   → `MACROS`) — `status`/`create_chain`/`add_step`/`conclude`/`get_trace`/
   `validate_step`/`list_chains`, a completely separate linear
   premise→step→conclusion substrate (`STATE.reasoning`, with confidence
   decay, hypothesis-engine integration, and metacognition-strategy
   recording). Exposed via its own REST routes (`server/routes/domain.js`
   `/api/reasoning/chains*`), NOT via `/api/lens/run`.
4. A fourth, smaller cluster also exists: `server/server.js` ~L39863
   registers `registerLensAction("reasoning", "validate"|"trace"|"conclude"|
   "fork", ...)` — thin handlers over the OLD generic `lensArtifacts` store.
   **Confirmed dead**: no frontend code calls these 4 names directly (grep
   across `concord-frontend`), and — this was the actual defect — the
   frontend's `Domain Actions Bar` used to reach `validate` (#4) through an
   alias table instead of reaching `logicValidate`/`fallacyDetect` (#1). See
   "Defects found + fixed" below.

Having three-plus substrates behind one domain name is not itself wrong (a
Kialo-style map, an HLR trace log, and a linear premise-chain tool are
legitimately different reasoning tools) — the wiring bugs came from the
frontend calling the wrong one, or the right one with the wrong field names.

## Backend surface — real, no stubs

**22 macros** in family #1 (7 stateless: `logicValidate`, `argumentMap`,
`fallacyDetect`, `premiseExtract`, `deepAnalysis`, `strengthAssessment`,
`counterArgumentGen` — the last 3 added this session; 15 persistent-map:
`map-list/create/get/update/delete`, `node-add/update/delete`,
`evidence-attach/detach`, `collaborator-add/remove`, `map-score`,
`map-export`, `scheme-list/instantiate`).
**3 macros** in family #2 (`traces`/`trace`/`run`).
**7 macros** in family #3 (`status`/`create_chain`/`add_step`/`conclude`/
`get_trace`/`validate_step`/`list_chains`).
**4 legacy macros** in family #4, confirmed dead (unreachable from any UI).

Every stateless macro in family #1 is deterministic pure-compute — no LLM
calls anywhere in `server/domains/reasoning.js` (confirmed: no `ctx.llm`/
`utilityCall` reference in the file). Family #3's chain engine is likewise
deterministic. Nothing here degrades on an LLM-off box because nothing
here needs an LLM — a real, intentional design choice given the domain
(logical validity/fallacy-pattern matching don't need a brain to be right).

| Macro (family) | Real result | DESIGNED / GENERIC / UNSURFACED |
|---|---|---|
| `logicValidate` (#1) | contradiction detection (negation/all-no/always-never pattern pairs) + term-overlap support score between premises and conclusion | DESIGNED — `ArgumentWorkbench` "Validate" + Domain Actions Bar "Validate Logic" |
| `argumentMap` (#1) | pro/con support-graph strength scoring (per-claim support/counter counts → 0–100 strength, uncontested/contested sets, strongest/weakest claim) | DESIGNED — `ArgumentWorkbench` "Map" + Domain Actions Bar "Assess Strength" (via `strengthAssessment`, which wraps this) |
| `fallacyDetect` (#1) | 8-pattern fallacy matcher (ad hominem, straw man, false dichotomy, appeal to authority, slippery slope, appeal to emotion, bandwagon, circular reasoning) over free text | DESIGNED — `ArgumentWorkbench` "Fallacies" + Fallacies tab "Auto-Detect" + Domain Actions Bar "Check Fallacies" |
| `premiseExtract` (#1) | sentence-level classification (premise/conclusion/statement × factual/normative/definitional) via indicator-word heuristics | DESIGNED — `ArgumentWorkbench` "Premises"; also the derivation step `actValidate`/`actMap` now call internally to turn free text into structured premises+conclusion/claims |
| `deepAnalysis` (#1, **new**) | composite: `logicValidate` + `fallacyDetect` + `premiseExtract` run together | DESIGNED — Analysis tab "Deep Analysis" |
| `strengthAssessment` (#1, **new**) | `argumentMap` with an auto-derived claims graph (root = conclusion, each premise a supporting child) when no explicit graph is supplied | DESIGNED — Analysis tab "Full Strength Assessment" + Domain Actions Bar "Assess Strength" |
| `counterArgumentGen` (#1, **new**) | deterministic critique scaffold: names the specific weak point (contradiction / unsupported term / matched fallacy) an opponent would attack, sourced from the two macros above — not free-form LLM prose | DESIGNED — Analysis tab "Generate Counter-Arguments" |
| `map-list/create/get/update/delete` (#1) | full CRUD for a persistent, per-user (+ collaborator) argument map | DESIGNED — `ArgumentMapStudio` |
| `node-add/update/delete` (#1) | pro/con tree branching under any node | DESIGNED — `ArgumentMapStudio` |
| `evidence-attach/detach` (#1) | credibility×relevance×weight-scored evidence per node | DESIGNED — `ArgumentMapStudio` |
| `collaborator-add/remove` (#1) | multi-author map sharing | DESIGNED — `ArgumentMapStudio` |
| `map-score` (#1) | recursive conclusion-confidence scoring (self strength ± weighted pro/con branch pressure) | DESIGNED — `ArgumentMapStudio` |
| `map-export` (#1) | markdown/outline/json export | DESIGNED — `ArgumentMapStudio` |
| `scheme-list/instantiate` (#1) | 8-scheme reasoning-pattern library (syllogism, analogy, causal, sign, authority, consequences, Toulmin, elimination) → instantiate into a new map | DESIGNED — `ArgumentMapStudio` |
| `traces`/`trace`/`run` (#2) | list/get/run against the real HLR engine (7 modes) | DESIGNED — `traces/page.tsx` (list+detail via dedicated REST routes, not these macro names directly, but the same underlying `hlr-engine.js` functions) |
| `status`/`create_chain`/`add_step`/`conclude`/`get_trace`/`validate_step`/`list_chains` (#3) | linear reasoning-chain engine with confidence decay, hypothesis/metacognition integration | DESIGNED — the Arguments-tab "Chain Builder" + "Chain Trace" viewer, via dedicated REST routes |
| `validate`/`trace`/`conclude`/`fork` (#4, legacy) | thin ops over the old generic `lensArtifacts` store | **Confirmed dead** — no frontend caller found. Left alone (harmless; see below) |

## Defects found + fixed

All four were confirmed by reading both the exact frontend call site and
the exact backend handler side by side — not assumed from either alone.

1. **🔴 Chain Builder was completely broken end-to-end (field-shape
   mismatches on every operation).** `concord-frontend/lib/api/client.ts`
   `apiHelpers.reasoning` sent `{premise, type}` to create a chain, but
   `createReasoningChain` reads `input.question`/`input.goal` — chains were
   always created with an empty question, and the chain-list UI rendered
   `chain.premise` (undefined; the real field is `question`). Adding a step
   sent `{content}`, but `addReasoningStep` reads `input.conclusion`/
   `input.justification`/`input.premises`, and **hard-rejects any step with
   no `justification`** (`if (requireJustification && !step.justification)
   return {ok:false, error:"Justification required..."}`) — the UI never
   sent one, so every "Add Step" click failed, silently (only
   `console.error`'d). Concluding a chain sent an empty body, so
   `concludeChain`'s `String(conclusion.statement || conclusion)` fell
   through to `String({chainId:"..."})` = the literal text
   **`"[object Object]"`** as the chain's conclusion. The trace viewer then
   rendered `trace.conclusion as string` directly as a JSX child — but
   `chain.conclusion` is a structured object (`{statement, confidence,
   supportingSteps, assumptions, derivedAt}`), which is not a valid React
   child and would throw at render time the moment a chain concluded (even
   accidentally, via the `[object Object]` bug above). Step rendering also
   read `step.content`/`step.validated`, neither of which exists on the
   real step shape (`conclusion`/`justification`/`rule`/`confidence`).
   **Fixed**: `client.ts` now sends `{question, goal, type}` /
   `{conclusion, justification, premises, rule, type}` / `{statement}`
   matching the real backend contract; `page.tsx`'s `Chain` interface,
   chain-list rendering, and the Chain Trace / Add Step / Conclude UI were
   corrected to the real field names, with a second "justification"
   input added (honestly required, not auto-filled) and `trace.conclusion`
   rendered as `.statement`. Also gave `createReasoningChain` a `type`
   field to persist (it silently dropped the chain-type selector before —
   a small, free ENGINEERING fix bundled in).
   Files: `server/server.js` (`createReasoningChain`), `concord-frontend/lib/api/client.ts`,
   `concord-frontend/app/lenses/reasoning/page.tsx`.

2. **🔴 `ArgumentWorkbench` — the "already correct" real-macro component —
   had systemic field-shape mismatches across all 4 of its analyses, one of
   which crashes.** `logicValidate` needs `{premises: string[], conclusion:
   string}` and `argumentMap` needs `{claims: [...]}` (a support graph);
   the component sent `{argument: "free text"}` to both, so Validate and
   Map always hit the macros' "provide premises/claims" empty-input branch
   — dead no-ops on every click. Worse: the frontend's `PremiseResult`
   interface assumed `{premises: string[]; conclusion: string; hidden:
   string[]}`, but the real `premiseExtract` macro returns `premises` as a
   **count** (`number`), not an array, with the real per-sentence data in
   `classified: [{text, role, type}]`. The render called
   `premiseResult.premises?.map(...)` — calling `.map` on a number is a
   guaranteed `TypeError` (`?.` only guards the `.premises` access, not the
   subsequent `.map` call), so clicking "Premises" and getting any real
   result would throw at render time. `ValidateResult`/`MapResult`/
   `FallacyResult` interfaces were similarly invented rather than read from
   the macros (real fields: `validity`/`hasContradictions`/`termSupport`/
   `recommendation`; `totalClaims`/`strengthMap`/`strongestClaim`;
   `fallacy`/`description` not `name`/`explanation`).
   **Fixed**: rewrote `ArgumentWorkbench.tsx`'s result interfaces to match
   the real macro return shapes exactly; `actValidate`/`actMap` now first
   call `premiseExtract` (which genuinely accepts free text) to derive
   `{premises, conclusion}` / a `{claims}` support graph, then feed that
   into `logicValidate`/`argumentMap` — real backend classification, not a
   client-side guess; all four result panes + the DM/publish/agent-prompt
   composers were updated to read the real fields.
   File: `concord-frontend/components/reasoning/ArgumentWorkbench.tsx`.

3. **🔴 The "AI-Powered Analysis" panel (Analysis tab) called three
   never-registered macro names, which the artifact-scoped `lens.run`
   dispatcher's unregistered-action fallback silently routed to the
   generic utility brain** — a live instance of the exact "unregistered
   macro masked as AI success" defect class this codebase documents as
   fixed at the top-level `/api/lens/run` dispatcher (it wasn't fixed at
   this second, artifact-scoped dispatch path). The panel's own copy reads
   "Run backend reasoning analysis engines against your arguments and
   chains" — implying real deterministic engines that did not exist for
   `deepAnalysis`/`counterArgumentGen`/`strengthAssessment`.
   **Fixed**: registered all three as real, deterministic
   `registerLensAction` handlers in `server/domains/reasoning.js` (built
   from the same core logic the 4 primitives use — factored into pure
   `logicValidateCore`/`argumentMapCore`/`fallacyDetectCore`/
   `premiseExtractCore` functions so nothing is duplicated). `deepAnalysis`
   composes validate+fallacy+premise; `strengthAssessment` derives a claims
   graph from premises+conclusion when no explicit graph is given;
   `counterArgumentGen` is a deterministic critique scaffold (names the
   specific contradiction/unsupported-term/fallacy an opponent would
   attack) rather than an LLM call dressed as an "engine" — kept
   consistent with the rest of this domain file, which is 100%
   deterministic by design (no `ctx.llm` calls anywhere in it).
   File: `server/domains/reasoning.js`.

4. **🟡 Domain Actions Bar (`Validate Logic`/`Check Fallacies`/`Assess
   Strength`) aliased to the wrong macro AND operated on stale/empty
   data.** The frontend action names (`validate_logic`/`check_fallacies`/
   `assess_strength`) all aliased, via `server.js`'s "Frontend Action
   Aliases" table, to the **same** generic `validate` handler (family #4,
   `steps.every(s=>s.content)` — vacuously `true` on an empty array) — so
   clicking "Check Fallacies" never ran fallacy detection at all, and all
   three buttons silently returned `{valid:true}` regardless of the actual
   chain. Separately, they operated on `chainArtifacts[0]` — a generic
   `lensArtifact` auto-synced **once**, from whichever chain loaded first,
   never updated as the user selects a different chain — whose `.data`
   shape (`{chainId, type, question}`) never carried premises/conclusion
   anyway. Clicking these buttons also gave **zero visible feedback**
   (no result pane existed for them at all).
   **Fixed**: re-pointed the three aliases at the correct macros
   (`logicValidate`/`fallacyDetect`/`strengthAssessment`); the handlers now
   derive real `premises`/`conclusion` from the **currently selected
   chain's** live trace (each step's `conclusion` as a premise line, the
   chain's own concluded `statement` or last step as the conclusion) and
   pass them as `params` (the macros now read `artifact.data` first,
   falling back to `params` — a backward-compatible addition, not a
   behavior change for existing callers); `Check Fallacies`'s result is
   now mapped into the page's `FallacyFlag` shape correctly (was pushing
   objects with the wrong keys into that array); added a small result
   panel under the Domain Actions Bar so a click is now visibly not a
   no-op.
   Files: `server/domains/reasoning.js`, `server/server.js` (alias table),
   `concord-frontend/app/lenses/reasoning/page.tsx`.

## Left alone

- **`app/lenses/reasoning/traces/page.tsx`** — already fully honest and
  correctly wired at audit start: reads `GET /api/reasoning/traces` /
  `GET /api/reasoning/trace/:id`, both direct `app.get` handlers calling
  the real `hlr-engine.js` `listTraces`/`getReasoningTrace` with no
  intervening shadow/alias layer. Confirmed no `setInterval`/fake-progress
  anywhere in the file. No changes made.
- **`ArgumentMapStudio.tsx`** — spot-checked against `reasoning-domain-parity.test.js`'s
  exact param shapes for `map-create`/`node-add`/`evidence-attach`/
  `collaborator-add`/`map-score`/`map-export`/`scheme-instantiate`; every
  call site matches the real macro signature. No changes made.
- **Family #4's 4 legacy generic-artifact macros** (`validate`/`trace`/
  `conclude`/`fork` in `server.js` ~L39863) — confirmed unreachable from
  any frontend code (grep across `concord-frontend` for `lensRun`/
  `runDomain` calls naming these four actions under domain `reasoning`
  found none). Left registered (harmless, and removing a possibly
  MCP-tool-reachable macro is out of scope for this pass) but no longer
  reachable via the alias table after fix #4 above.
- **The `ReasoningArxiv` component** — not touched; it renders a distinct,
  separately-sourced feed and wasn't implicated in any of the four defects.

## Genuinely missing (deferred) — triage

- **`counterArgumentGen`'s critique quality is a fixed rule set, not a real
  argumentation-theory engine.** Triage: **ENGINEERING** (no external data
  dependency) — could be extended with more attack-pattern rules (weak-link
  identification via the map's `weakestClaim`, scheme-specific critical
  questions from the `SCHEMES` library already in this file) in a future
  pass. Not a blocking gap: it already surfaces the two real signals
  (contradictions, matched fallacies) an opponent would actually use.
- **No LLM-backed "steelman"/adversarial mode.** `ArgumentWorkbench`'s
  separate "Cross-check" button already covers this honestly (explicitly
  agent-backed, via `chat_agent.do`, not disguised as a deterministic
  macro) — the composite macros stay deterministic by design, matching the
  rest of the domain file. No action needed.

## Verification

- `node --check server/domains/reasoning.js` → OK
- `node --check server/server.js` → OK
- `node --test tests/reasoning-domain-parity.test.js` (run from `server/`)
  → **17/17 passing** (exercises `logicValidate`/`argumentMap`/
  `fallacyDetect`/`premiseExtract` plus the full map-CRUD/node/evidence/
  collaborator/score/export/scheme substrate — confirms the core-function
  refactor changed nothing observable)
- `node --test tests/reasoning-domain-macros.test.js` (run from `server/`)
  → **7/7 passing** (HLR trace macro family, untouched, still green)
- `node --test tests/depth/reasoning-behavior.test.js` (run from `server/`)
  → **passing** (real behavioral/exact-computed-value coverage over the
  boot-in-memory server, via `lensRun`)
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 (unchanged; `reasoning` and `reasoning/traces` were already
  WIRED before and after)
- `node scripts/grade-ux-polish.mjs --honest` → `reasoning` entry:
  `"tier":"polished"`, `"isGenericScaffold":false`, `"honestCapped":false`
- `npx eslint` **could not run** — this worktree has no `concord-frontend/node_modules`
  at all (`Cannot find module '@eslint/eslintrc'`/vitest fails the same
  way) — a pre-existing environment condition, not introduced by this
  change. Did not attempt a full `npm install` given the standing OOM/
  stability warnings for this shared worktree; instead did a careful manual
  review of every edited `.tsx`/`.ts` file's types (all touched interfaces
  now match the real backend return shapes 1:1, verified against the
  passing backend tests above) and did not run `tsc` per the unit's
  standing rule.
- `git checkout -- audit/ux-polish-honest.json audit/ux-polish-honest-gaps.md`
  run after grading (regenerated artifacts reverted, not committed).
