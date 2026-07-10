# Inference Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every field-shape and invariant-blocking claim
> below was checked against a LIVE macro trace on the booted server, not
> just a source-read.

## Backend surface

```
grep -c 'registerLensAction("inference"' server/domains/inference.js   # → 13
grep -n 'register("inference"' server/server.js | wc -l                # → 6
```

`node scripts/lens-unsurfaced.mjs --lens inference` → **0/13 macros never
referenced** (the domain filename matches the lens name here, unlike
`import`/`hypothesis`, so the script works correctly for the 13-macro
`registerLensAction` cluster). Six more macros (`status`, `add_fact`,
`add_rule`, `query`, `syllogism`, `forward_chain`) are registered inline
in `server.js` under the same `"inference"` domain string via the plain
`register()` family — invisible to the script for the same reason as
`hypothesis`'s legacy engine, but (unlike hypothesis) **not shadowed** —
this is the one true engine for these six names, backed by
`STATE.reasoning.knowledgeBase` (`ensureInferenceKnowledgeBase`,
`server.js:67284+`). All 6 have real frontend call sites via
`apiHelpers.inference.*` — but every one of the primary, most-visible
ones was broken by field-shape mismatches, and two of the six were
provably unreachable by a completely separate, systemic bug (see below).

Two engine generations coexist by design, not by accident: the 13
`registerLensAction` macros split into stateless one-shot calculators
(`forwardChain`, `backwardChain`, `unify` — facts/rules/goal passed in
per-call, nothing persisted) and a persistent per-user Prolog/Drools-shape
knowledge base (`kb-add`/`kb-list`/`kb-remove`/`kb-clear`/`kb-check`/
`kb-query`/`kb-explain`/`kb-trace`/`kb-forward`/`kb-seed-sample`, comment
at `server/domains/inference.js:516`: "2026 parity — Prolog / Drools rule
engine"). `RuleEngineWorkbench.tsx` (772 lines) correctly wires all 10
`kb-*` macros with real forms — independently verified, no changes needed.

## The defects this wave found and fixed — four distinct bugs, one shared root pattern

**1. `add_fact` field-shape mismatch.** `addInferenceFact` (`server.js:67284`)
reads `input.subject`/`input.predicate`/`input.object` directly off the
POST body. The frontend sent `{facts: factInput.split('\n')}` — an array
of raw strings the handler never reads — so every "Add Facts" click added
one blank fact (`subject:"", predicate:"", object:""`) regardless of what
was typed.

**2. `query` field-shape mismatch.** `queryWithInference(query)`
(`server.js:67560`) reads `query.subject`/`.predicate`/`.object` directly
off its single parameter — but the route handler calls
`queryWithInference(input)` where `input` is the whole POST body, and the
frontend sent `{query: queryInput}` (a free-text string wrapped under a
`query` key). So the parameter named `query` was `{query:"..."}`, and
`.subject`/`.predicate`/`.object` were always `undefined` — every search
ran fully wildcarded, ignoring the typed text entirely.

**3. `syllogism` field-shape mismatch.** `syllogisticReason(input)`
reads `input.majorPremise`/`input.minorPremise`. The frontend (and the
`apiHelpers.inference.syllogism` type signature) sent `{major, minor}` —
always undefined, so the "Derive Conclusion" button failed
`"Major premise must be in form 'All X are Y'"` on every click, for every
input.

**4. Systemic, cross-domain: `enforceEthosInvariant`'s naive substring
match blocked `add_fact`/`add_rule` for an unrelated reason — found live,
not by reading code.** After fixing (1), a real end-to-end trace against
the booted server still failed: `add_fact` threw
`"Ethos invariant: ads forbidden"`. `enforceEthosInvariant` (`server.js:2865`)
checked `actionName.includes("ad")` to block a hypothetical future
ads-tracking macro — but `"inference_add_fact".includes("ad")` is true
(from **add**), so it blocked every call. Grepped all 134 registered
`enforceEthosInvariant(...)` call sites for the same false-positive
pattern: **`commonsense_add`, `metacognition_adapt`,
`metacognition_adjust_confidence`, `metalearning_adapt`,
`metalearning_adaptations`** are also blocked by this same bug, in
domains outside this wave's assignment. None of the 134 real action names
is genuinely about advertising, so the substring form had zero
true-positive value in the current codebase while producing at least 7
confirmed false positives.

**Bonus finding (5), same investigation:** the exact worked example in
`syllogisticReason`'s own code comment — `"All mammals are warm-blooded"` +
`"A whale is a mammal"` — failed `"Category mismatch: mammal does not
match mammals"`. The major premise's category is grammatically plural
("All **mammals** are…") while the minor premise's is singular ("A whale
is a **mammal**"), and the parser never normalized between them. Every
syllogism phrased in ordinary English (which is the only form the "All X
are Y" / "Z is a X" instructions describe) failed.

## What changed this wave

**`server/server.js`:**
- `enforceEthosInvariant` — switched from `actionName.includes(word)` to
  exact-token matching (tokenize on non-alphanumeric characters, compare
  each token). Preserves the invariant's real intent (still blocks a
  genuine `show_ads`/`ad_click`/`user_telemetry_sync`/`secret_tracking`/
  `user_fingerprinting`-shaped action name — verified live, see
  Verification) while no longer false-positiving on ordinary CRUD verbs
  that happen to contain "ad" as a substring.
- `syllogisticReason` — added `_singularizeCategory` (regular-plural
  singularizer: `mammals→mammal`, `foxes→fox`, `classes→class`; leaves
  `class`/`bus`-shaped words alone) applied to the major premise's
  category before the match-check and before storing the derived facts.
  Irregular plurals (`mice`/`mouse`) remain an honest, documented
  limitation, not a new defect.

**`concord-frontend/lib/api/client.ts`, `inference` block:** corrected
`facts`/`query`/`syllogism`/`forwardChain` TypeScript signatures to match
the real handlers' field names exactly (`{subject,predicate,object}`,
`{majorPremise,minorPremise}`, `{maxIterations?}`) instead of the
mismatched shapes that caused defects 1-3 above.

**`concord-frontend/app/lenses/inference/page.tsx`:**
- "Add Facts" — replaced the freeform textarea with a real 3-field
  subject/predicate/object form (one fact per submit, matching the
  handler's actual one-fact-per-call contract, rather than pretending a
  multi-line paste could ever have worked).
- "Query" — replaced the single free-text input with 3 optional
  subject/predicate/object fields (blank = wildcard, matching
  `matchFact`'s real semantics).
- "Syllogism" — field names only fixed (UI unchanged, already had two
  premise inputs).
- **New "Unify" tab** — `unify` (`server/domains/inference.js:357`, a
  standalone Robinson's-algorithm term unifier) had zero working callers:
  the old "Logical Inference Actions" quick panel routed it through an
  auto-created blank `snapshot` artifact with no `term1`/`term2`, so it
  always failed `"Both term1 and term2 are required."` — the same
  generic-artifact-bridge defect class already found in the hypothesis
  and import lenses this wave. `unify` isn't covered by the `kb-*` family
  at all (no persistent-KB equivalent exists), so it gets a real tab: a
  bounded, non-JSON-paste Prolog-term parser (`functor(arg1, arg2)`
  compound terms, `?X`-prefixed variables, bare constants) with its own
  bespoke result rendering (unifiable/MGU bindings/unified term/
  verification), reusing render logic that already existed but was
  unreachable.
- **Removed the entire broken "Logical Inference Actions" panel**
  (`forwardChain`/`backwardChain`/`unify` via the auto-created-blank-
  artifact pattern). `forwardChain` is redundant with `kb-forward`
  (persistent, conflict-resolution-aware, already correctly wired in
  `RuleEngineWorkbench.tsx`); `backwardChain` is redundant with
  `kb-query` (goal-directed proof search against the persistent KB,
  same file). `unify` moved to its own real tab (above). Removed the
  now-dead `useLensData`/`useRunArtifact`/`handleInfAction` plumbing;
  kept `useLensBridge` (a real, working sync of engine status into an
  artifact, used correctly by the existing `UniversalActions` call).

Files touched:
- `server/server.js` — `enforceEthosInvariant` token-boundary fix,
  `syllogisticReason` singularization fix.
- `concord-frontend/lib/api/client.ts` — `inference` block field-name
  corrections.
- `concord-frontend/app/lenses/inference/page.tsx` — 3-field Facts/Query
  forms, new Unify tab + result renderer, removed broken quick panel.

## Left alone

The 10 `kb-*` macros (already correctly wired in `RuleEngineWorkbench.tsx`,
independently verified — no changes needed). `analysisHistory`-shaped
macros don't exist in this domain (that was a hypothesis-lens item).

## Verification

- `node --check server/server.js` && `node --check
  server/domains/inference.js` → OK.
- `cd server && node --test tests/inference-domain-parity.test.js
  tests/inference-metering.test.js tests/hypothesis-domain-parity.test.js
  tests/commonsense-domain-parity.test.js
  tests/commonsense-lens-macros.test.js
  tests/metacognition-domain-parity.test.js
  tests/metalearning-domain-parity.test.js` → 127/127 passing (the
  broader sweep covers every domain touched by the `enforceEthosInvariant`
  fix that has a test file).
- `cd concord-frontend && npx eslint app/lenses/inference/page.tsx
  components/inference/*.tsx lib/api/client.ts` → clean.
- **Live macro traces** (`server/tests/depth/_harness.js`):
  - `add_fact({subject:"socrates",predicate:"is",object:"human"})` →
    `{ok:true,fact:{...}}` (was `{ok:false,error:"macro_uncaught_throw",
    message:"Ethos invariant: ads forbidden"}` before both fixes).
  - `query({subject:"socrates"})` after adding a `humans→mortal` rule →
    correctly found both the base fact AND the modus-ponens-derived
    `"socrates is mortal"` fact.
  - `syllogism({majorPremise:"All mammals are warm-blooded",
    minorPremise:"A whale is a mammal"})` (the function's own documented
    example) → `{ok:true, conclusion:"Whale is warm-blooded"}` (was
    `{ok:false, error:"Category mismatch: mammal does not match mammals"}`
    before the singularization fix).
  - `unify({term1:{functor:"loves",args:["john","?Y"]},
    term2:{functor:"loves",args:["?X","mary"]}})` → correctly unifiable,
    MGU `{?X:"john", ?Y:"mary"}`, unified term `loves(john, mary)`.
  - Ethos-invariant token-matching verified bidirectionally in isolation:
    all 7 previously-false-positived action names now pass, while
    `show_ads`/`ad_click`/`user_telemetry_sync`/`secret_tracking`/
    `user_fingerprinting` are still correctly blocked.
