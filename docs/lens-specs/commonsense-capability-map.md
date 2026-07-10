# Commonsense Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("commonsense"' server/domains/commonsense.js` → 15

## Reference apps + parity target

- **ConceptNet 5 (conceptnet.io)** — the open commonsense knowledge graph
  this lens is directly built on (`api.conceptnet.io`, free, no key,
  ~34M edges / 304 languages). Parity target for the concept-exploration
  side: radial/breadcrumb navigation of a concept's edges, relation-type
  filtering, weighted relatedness between two concepts, and a path from
  "look something up" to "save the assertion somewhere durable."
- **A graph-explorer (Neo4j Bloom / Browser style) over a user's own
  triple store** — parity target for the fact-management side: add/
  browse/filter subject-relation-object triples, visualize them as a
  graph (not just a table), derive new facts via transitive closure,
  detect logical contradictions, and trace a fact's provenance/derivation
  chain — the graph-database-workbench shape, scoped to one user's
  knowledge base instead of a shared enterprise graph.
- **Parity target** (combined): the only difference between this lens and
  ConceptNet's own web UI + a personal Neo4j-Bloom-style workbench should
  be catalog size and polish — every edge, relatedness score, inference,
  and contradiction should trace to a real macro call over real data,
  never a hand-typed or fabricated number.

## Ground truth — the domain has TWO backend stores, easy to conflate

`server/domains/commonsense.js` registers a single **per-user
subject-relation-object triple store** (`csState().commonsenseLens.facts`,
a `Map` on `globalThis`, not DB-persisted — a working-session knowledge
base by design) plus two live ConceptNet HTTP calls. This is the store
all 15 macros audited below operate on.

Separately, `server.js` (`ensureCommonsenseSubstrate` / `seedCommonsense`,
~`server.js:66392`) registers an **unrelated, auto-seeded, sentence-shaped
axiom store** under the *same* domain string `"commonsense"` but with
different macro names (`status`, `query`, `add_fact`, `list_facts`,
`surface_assumptions`, `get_assumptions`), reached only via
`/api/commonsense/*` REST routes (`server/routes/domain.js:715-738`), not
via `registerLensAction`/`POST /api/lens/run`. Its facts look like
`{ id, fact: "Objects fall when dropped", category, confidence }` — no
`subject`/`relation`/`object` at all. This is a real, pre-existing DTU-
assumption-surfacing subsystem (used to flag implicit assumptions in
authored DTUs), not part of the 15-macro commonsense lens surface, but it
shared the domain name and the page had been wired to it by mistake (see
Bug 1 below).

## Capability audit — all 15 registered macros

| Macro | Bucket | Where it's designed |
|---|---|---|
| `factAdd` | DESIGNED | Page-level "Add Fact" form (top of page) + `KnowledgeBaseWorkbench` add-fact bar — both write the same triple store after this rebuild's fix |
| `factList` | DESIGNED | Page-level List/Graph/Stats views + `KnowledgeBaseWorkbench` fact list/provenance sidebar |
| `factDelete` | DESIGNED | `KnowledgeBaseWorkbench` provenance-tab trash icon per fact |
| `knowledgeGraph` | DESIGNED | `KnowledgeBaseWorkbench` "Knowledge Graph" tab — focus/depth controls, ConceptNet-enrich toggle, `TreeDiagram` render + degree bar chart (`ChartKit`) |
| `inferChain` | DESIGNED | `KnowledgeBaseWorkbench` "Inference Chain" tab — hops/min-confidence controls, derivation trace per row, one-click "Commit" to persist a derived fact |
| `contradictionScan` | DESIGNED | `KnowledgeBaseWorkbench` "Contradictions" tab — consistent/inconsistent banner + per-contradiction detail (kind, severity, both conflicting facts) |
| `relationTaxonomy` | DESIGNED | `KnowledgeBaseWorkbench` "Relation Taxonomy" tab — grouped browsing (Taxonomic/Compositional/Functional/Causal/Spatial-Lexical) with live usage counts, click-to-select feeds the add-fact relation dropdown |
| `confidenceQuery` | DESIGNED | `KnowledgeBaseWorkbench` "Confidence Query" tab — "things very likely true about X," min-confidence slider, local-vs-ConceptNet origin badges |
| `extractFacts` | DESIGNED | `KnowledgeBaseWorkbench` "Text Import" tab — paste text, preview extracted triples with source sentence, optional commit to store |
| `provenanceChain` | DESIGNED | `KnowledgeBaseWorkbench` "Provenance" tab — per-fact derivation/evidence chain with independently-verified badge |
| `plausibilityCheck` | DESIGNED | `CommonsenseActionPanel` — free-text statement input, score/label/violations breakdown by severity |
| `analogyMapping` | DESIGNED | `CommonsenseActionPanel` — source/target domain inputs (JSON or free-text label), entity-mapping + systematicity score + candidate inferences |
| `defaultReasoning` | DESIGNED | `CommonsenseActionPanel` — JSON class-hierarchy input, resolved properties with per-key source attribution, override/sibling-conflict counts, cycle/conflict warnings |
| `conceptnet-edges` | DESIGNED | `ConceptExplorer` (radial concept browser: breadcrumb nav, relation-type filter chips, Save-as-DTU per edge) + `CommonsenseActionPanel` |
| `conceptnet-relatedness` | DESIGNED | `CommonsenseActionPanel` — two-concept relatedness score + interpretation label |

**Result: 0 GENERIC-STRIP-ONLY, 0 UNSURFACED.** All 15 macros already had
a real, bespoke, non-generic home before this rebuild pass — a strong
sign the lens had already been through a rebuild loop (`KnowledgeBaseWorkbench`
carries its own header comment: *"Every value rendered comes from a real
macro call. No seed/mock data"*). `scripts/lens-unsurfaced.mjs --lens
commonsense` independently confirms 0/15 unsurfaced.

## ConceptNet-edges/relatedness: verified REAL, not fabricated

Per the task's specific concern about live-API-shaped features being
faked: `conceptnet-edges` (`server/domains/commonsense.js:664`) and
`conceptnet-relatedness` (`:706`) issue real `fetch()` calls to
`https://api.conceptnet.io/c/...` and `/relatedness`, parse the actual
JSON edge/weight shape ConceptNet returns, and propagate network failure
honestly (`{ ok: false, error: "conceptnet unreachable: ..." }`) rather
than falling back to invented data. `knowledgeGraph` and `confidenceQuery`
also call ConceptNet live (via `cachedFetchJson`, 10-minute TTL cache) and
degrade gracefully to local-only results on failure. No fabrication found.

## Bugs found and fixed this rebuild

**Bug 1 (real, load-bearing) — the page's top-level facts list was wired
to the wrong backend store and would render `undefined` or throw.** Before
this fix, `app/lenses/commonsense/page.tsx` fetched its main `rawFacts`
from `apiHelpers.commonsense.facts()` → `GET /api/commonsense/facts` →
`runMacro("commonsense", "list_facts", ...)` — the **sentence-shaped axiom
store** described above (`{ id, fact, category, confidence }`), while the
page's `Fact` type and every render path (`f.subject`, `f.relation`,
`f.object`) assumed the **triple-shaped** store the rest of the lens
(`KnowledgeBaseWorkbench`, `ConceptExplorer`, `CommonsenseActionPanel`) is
built on. Concretely:
  - The List view called `f.relation.replace(/_/g, ' ')` unconditionally
    on every row. Since the axiom store has no `relation` field, this is
    `undefined.replace(...)` — a hard render crash. The axiom store is
    auto-seeded with 27 axioms on first read (`seedCommonsense()`), so
    this was reachable on every page load in the default `list` view,
    not an edge case.
  - "Add Fact" wrote to the axiom store (`add_fact`) while everything
    else on the page read from the triple store — a fact added at the
    top of the page would never appear in the graph, inference chain,
    contradiction scan, or provenance trace below it, silently forking
    "one knowledge base" into two.
  - The "Relation Types" / "Inferences" stat tiles read
    `statusInfo.relations` / `statusInfo.inferences` from the axiom
    store's `status` macro, which returns neither field — always `0`/
    fallback, a permanently-uninformative tile.

  **Fix**: repointed the page's facts query, add-fact mutation, and
  "Inferences" stat to the same `factList` / `factAdd` / `inferChain`
  triple-store macros the rest of the lens already uses (`lensRun`
  instead of the legacy REST helper), so the whole page is one
  consistent knowledge base and the crash path is gone. The separate
  "Query Knowledge Base" panel (free-text search over the axiom store)
  is a real, working, distinct feature — kept, but relabeled "Ask the
  Built-in Commonsense Base" with a one-line explanation that it's a
  separate reference base from the user's own fact triples, since
  presenting two backing stores under one undifferentiated "knowledge
  base" heading was itself a source of confusion even where it didn't
  crash.

No other defects found — no fabricated data, no generic action-array
scaffold standing in front of real depth, no dead/duplicate controls.

## Left alone (already real, already well-designed)

- `KnowledgeBaseWorkbench` (~820 LOC) — tabbed workbench covering all 7
  "backlog" macros with real, bespoke treatments: a `TreeDiagram` +
  degree bar chart for the knowledge graph, a derivation-trace UI with
  one-click commit for inference chains, a severity-coded contradiction
  list, a grouped taxonomy browser, a confidence-ranked query view with
  local/ConceptNet origin badges, a text-import preview/commit flow, and
  a two-pane provenance tracer.
- `ConceptExplorer` — radial ConceptNet browser with breadcrumb history,
  relation-type filter chips, and Save-as-DTU per assertion.
- `CommonsenseActionPanel` — reasoning bench for
  plausibility/analogy/default-reasoning/ConceptNet edges+relatedness,
  plus mint/DM/publish/agent-insight actions with pipe hand-off between
  panels and recallable (undo-window) send/publish actions. Its own
  header comment documents a prior fix (moving `defaultReasoning` off a
  dead generic per-artifact dispatch path onto a direct macro call) —
  consistent with this rebuild's finding that the domain has a history of
  real, careful wiring work, not scaffold.

## Verification

- `npx eslint app/lenses/commonsense/page.tsx components/commonsense/*.tsx` — clean, 0 errors / 0 warnings.
- `npx tsc --noEmit -p .` — 0 errors introduced (one pre-existing/unrelated error surfaced in `components/diy/ProjectWorkshop.tsx` from a concurrent sibling agent's in-progress edit on a different lens; not touched by this rebuild).
- `node scripts/verify-lens-backends.mjs` — commonsense stays WIRED (`258 WIRED / 2 by-design NO-BACKEND-CALL`, commonsense not in the NO-BACKEND-CALL list).
- `node scripts/grade-ux-polish.mjs --honest` — commonsense: `tier: "polished"`, `isGenericScaffold: false`.
