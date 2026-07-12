# DTUs Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/dtus.js` (938 lines) and grepping the frontend page +
> every component under `concord-frontend/components/dtus/`. Reproduce:
> `grep -c 'registerLensAction("dtus"' server/domains/dtus.js` → 17,
> `node scripts/lens-unsurfaced.mjs --lens dtus` → `0/17 macros never
> referenced in the frontend`.

## 0. What this lens actually is

`dtus` is not a content-vertical lens — it is the human-facing
browser/workbench for Concord's own knowledge substrate (Discrete Thought
Units: four layers human/core/machine/artifact, MEGA/HYPER consolidation,
citation royalties — see CLAUDE.md's "DTU substrate" section). Given the
component names already on disk (`CitationGraph`, `LineageTreePanel`,
`FacetedSearchPanel`, `CompareMergePanel`, `SavedViewsPanel`, `LayerEditor`),
the honest reference category is a **graph-based personal-knowledge-base
tool** — not Notion (block-doc editor), not a generic CRUD list.

**Reference app: Obsidian**, cross-checked against **Roam Research** for the
graph/backlink idiom specifically (Obsidian for the overall shape — vault
browser + tags/folders + graph view + backlinks pane; Roam for the
citation-graph-as-primary-navigation angle, since Concord's "citation" *is*
royalty-bearing lineage, closer to Roam's block-reference graph than
Obsidian's file-link graph). **Parity statement**: the only difference
should be that Concord's "notes" are DTUs with a real economic layer
(citation → royalty cascade) and four structured layers instead of Obsidian's
single markdown body — browsing, searching, graph-navigating, comparing/
merging duplicates, and saving smart collections should feel and function
the same.

## 1. Backend surface — full macro enumeration

### 1a. `server/domains/dtus.js` — macro domain `dtus` (17 macros, all real)

| Macro | What it does | Disposition |
|---|---|---|
| `lineageAnalysis` | Parent-chain depth, fork count, generation breakdown, lineage health | **DESIGNED — FIXED THIS SESSION** (was silently broken, see §2 finding 1) — "DTU Compute Actions" panel |
| `qualityScore` | 4-factor score (content/metadata/citations/freshness) + grade + recommendations | **DESIGNED — FIXED THIS SESSION**, same panel |
| `citationNetwork` | In/out-degree, h-index analog, influence score, top citers | **DESIGNED — FIXED THIS SESSION**, same panel |
| `tierRecommendation` | Promote/demote/maintain recommendation vs. current tier | **DESIGNED — FIXED THIS SESSION**, same panel |
| `duplicateDetection` | Trigram + tag-Jaccard similarity against sibling DTUs | **DESIGNED — FIXED THIS SESSION**, same panel |
| `citationGraph` | Projects a corpus into a node-link graph (nodes + edges + hubs + density) | **DESIGNED** — Knowledge Workbench "Citation Graph" tab (`CitationGraph.tsx`, real SVG radial layout) |
| `facets` | Bucket counts (layer/tier/scope/quality/tag) over a corpus | **DESIGNED** — `FacetedSearchPanel.tsx` sidebar chips |
| `facetedSearch` | Filters a corpus by the facet selection | **DESIGNED** — same panel's live filter |
| `lineageTree` | Recursive MEGA→originals / HYPER→MEGAs→originals tree | **DESIGNED** — Knowledge Workbench "Lineage Tree" tab (`LineageTreePanel.tsx` + `TreeDiagram`) |
| `bulkOp` | Validates + plans a tag/untag/cite/tier/archive change set over N DTUs | **DESIGNED — REWORKED THIS SESSION** (see §2 finding 2) — "Bulk Ops" tab |
| `compareDtus` | Field-by-field diff + trigram/tag similarity + merge recommendation | **DESIGNED** — "Compare / Merge" tab |
| `mergeDtus` | Produces a merged-record preview + tombstone recommendation | **DESIGNED — REWORKED THIS SESSION** (see §2 finding 3), same tab |
| `saveView` | Persists a named facet filter ("smart collection") | **DESIGNED** — `SavedViewsPanel.tsx` |
| `listViews` | Lists the user's saved views | **DESIGNED**, same panel |
| `deleteView` | Deletes a saved view | **DESIGNED**, same panel |
| `getLayers` | Returns the editable 4-layer payload (seed or per-user overlay) | **DESIGNED** — "Layer Editor" tab (`LayerEditor.tsx`) |
| `updateLayers` | Persists 4-layer edits as a per-user overlay, JSON-validates the machine layer | **DESIGNED**, same tab |

**Coverage: 17/17 real macros, all DESIGNED (no generic-strip-only, no
unsurfaced).** `node scripts/lens-unsurfaced.mjs --lens dtus` confirms
`0/17 macros never referenced in the frontend`.

### 1b. Sibling domain `dtu` (singular) — the CRUD/lifecycle substrate this lens's browse/create/detail features actually sit on

Registered inline in `server.js` (`register("dtu", ...)`, ~19 macros:
`create`/`get`/`update`/`delete`/`stats`/`list`/`listByKind`/`listShadow`/
`syncFromGlobal`/`cluster`/`gapPromote`/`saveSuggested`/`define`/`reconcile`/
`dedupeSweep`/`protocol_validate`/`causal-link`/`causal-trace`/`confidence`).
`server/routes/dtus.js` wraps these as `GET/POST/PUT/PATCH/DELETE
/api/dtus[/:id]` — the REST surface `page.tsx`'s pagination, search, create,
and (as of this session) the Bulk Ops / Compare-Merge persist actions all
call, either via the typed `apiHelpers.dtus.*` wrappers or directly via
`lensRun('dtu', 'update'|'create'|'delete', ...)`. **Distinct macro-domain
string from `dtus` (plural)** — `dtu.update`/`dtu.create`/`dtu.delete` are
what a bulk-op or a merge action must call to actually persist a change;
`dtus.bulkOp`/`dtus.mergeDtus` only ever computed the *plan* (see §2).

### 1c. Adjacent domains checked and confirmed OUT OF SCOPE

- **`dtu_surface`** (`server/domains/dtu-surface.js` — `record`/`where_used`/
  `surfaced_from`/`provenance_trail`). Confirmed real and already wired —
  but through shared components `components/dtu/ProvenanceTrail.tsx` +
  `components/dtu/DownstreamBadge.tsx`, mounted inside `DTUDetailView.tsx`
  (`grep -n "ProvenanceTrail\|DownstreamBadge" concord-frontend/components/dtu/DTUDetailView.tsx`
  → lines 561/571). `DTUDetailView` is the modal this lens opens on row
  click, but the file itself lives in `components/dtu/` (singular), not
  `components/dtus/` (plural) — outside this rebuild's permitted edit
  scope, and correctly so: it's a shared cross-lens component, not owned by
  this lens. **No gap** — provenance/where-used is real and reachable from
  this lens today, just not through a file this rebuild touches.
- **`dtu_portability`** (`server/domains/dtu-portability.js` —
  `export`/`validate`/`import`, corpus-level GDPR-style backup/restore,
  shipped as "Phase 6b" per CLAUDE.md). Confirmed **zero frontend callers
  anywhere in the entire codebase** (`grep -rln "dtu_portability" concord-frontend/`
  → no results), not just absent from this lens. This is a genuine gap, but
  it belongs to a *future dedicated settings/backup surface*, not to a
  DTU-browser rebuild — flagged, not built.
- **`decomp`** (`server/domains/decomp.js` — Persistent Goal Decomposition,
  migration 340, a durable subgoal tree that happens to mint a DTU as a
  side effect). Confirmed **unrelated by design** — the file's own header
  comment: "Distinct from the OKR `goals` domain and the agent-initiative
  goals — this is the durable plan scaffold the R&D engine (#21) hangs work
  on." Not part of the DTU browser; out of scope.

## 2. Fake-data / broken-wiring findings and how each was resolved

1. **🔴 The "DTU Compute Actions" panel (5 buttons: Lineage Analysis /
   Quality Score / Citation Network / Tier Recommendation / Duplicate
   Detection) was silently broken on every single click, in every
   deployment.** Root cause, traced end to end:
   - `page.tsx` dispatched via `useRunArtifact('dtus').mutateAsync({id, action})`
     → `POST /api/lens/dtus/{id}/run` → `register("lens","run",...)`
     (`server.js:38269`) → `STATE.lensArtifacts.get(id)`.
   - `STATE.lensArtifacts` is the **generic per-user artifact CRUD store**
     (the same one `useLensData`/`useRunArtifact` serve *many* lenses with —
     each lens's own domain-specific content, created via
     `POST /api/lens/:domain`). Real DTUs live in a **completely separate
     substrate** (`STATE.dtus`, the actual DTU corpus) — confirmed nothing
     in the codebase ever `POST`s a generic artifact under domain `'dtus'`
     (`grep -rn "useLensData(.'dtus'\|api\.post(.'/api/lens/dtus'" concord-frontend/`
     → only the one dead read call, below). So `STATE.lensArtifacts.get(realDtuId)`
     always returned `undefined` → `{ok:false, error:"not found"}`.
   - Because `/api/lens/run`-family routes double-wrap (`{ok:true, result:{ok:false,...}}`),
     `page.tsx`'s `if (res.ok === false)` check tested the **outer** wrapper
     (always `true`) and missed it, then set `actionResult = {ok:false, error:"not found"}`
     — a shape none of the 5 result-display blocks recognize, and the
     catch-all fallback block required an `actionResult.message` field this
     shape doesn't have either. Net effect: click the button, see a spinner,
     see a "Result" header appear with **zero body content** — a completely
     silent failure, exactly the "referenced but not actually reachable"
     defect class this program exists to find.
   - **Compounding dead-store bug**: the target-id fallback read
     `useLensData<Record<string,unknown>>('dtus','dtu',{seed:[]}).items[0]?.id`
     — the *read* side of the same never-written generic-artifact store, so
     `dtuLensItems` was **always `[]`**, identical in shape to the
     atlas-lens's confirmed `atlasItems[0]?.id` always-undefined bug found
     in an earlier wave of this program.
   - **Fix**: switched dispatch to `lensRun('dtus', action, input)` — the
     exact mechanism every *other* panel on this page already uses
     correctly (`/api/lens/run`'s `LENS_ACTIONS` path synthesizes a
     `virtualArtifact` from the input directly, no artifact-store lookup at
     all). Removed the dead `useLensData` import/fallback; the real target
     id now falls back to the actually-loaded corpus's first row
     (`dtus[0]?.id`). Added `buildComputeActionInput()` in `page.tsx`,
     constructing a real per-action payload from the selected DTU's actual
     fields (`parents`/`children`/`tags`/`tier`/`meta.citationCount`/
     `coherence`) plus two honestly-scoped derived fields the substrate has
     no materialized counter for: `citedBy` (DTUs in the *currently loaded
     page* whose `parents` include the target — the same "parents = cites"
     convention `citationGraph`'s own handler already uses) and `siblings`
     (the rest of the loaded page, for duplicate comparison). `viewCount`/
     `forkCount` are left unset (the macro's own `parseInt(x)||0` default is
     an honest "not tracked," not a fabricated number).
   - **Companion backend fix (`server/domains/dtus.js`, all 5 handlers)**:
     each handler previously read `artifact.id`/`artifact.title`/
     `artifact.meta.*`/`artifact.updatedAt` directly — fields that are only
     populated when invoked against a *real* `STATE.lensArtifacts` record,
     never true for this lens (see above). Added a `params → artifact.data
     → artifact.meta → artifact.id/title` fallback chain to every field read
     (tags/status/visibility/citationCount/tier/updatedAt/dtuId/title),
     fully backward compatible — the 47 pre-existing contract tests
     (`tests/dtus-domain-parity.test.js` 22/22, `tests/dtu-quality-scoring.test.js`
     25/25) that call these handlers with a real-artifact-shaped `{id, data,
     meta}` still pass unchanged, because those tests' explicit `params`
     rarely set the same keys and the fallback lands on the old
     `artifact.*` reads exactly as before.
   - Also added an honest empty/disabled state: the panel header now shows
     which DTU the buttons will run against (or "no DTU loaded to target"),
     and the 5 buttons disable when there is truly nothing to target,
     instead of a silent no-op.

2. **🟡 `BulkOpsPanel` implied every bulk operation was *applied* when
   `dtus.bulkOp` is, by its own docstring, "a planning/preview macro... the
   caller persists via the substrate REST endpoints" — and the frontend
   never took that second step.** The result summary literally read `"tag
   applied to 3 DTUs"` in past tense, with no persistence behind it.
   Checked what's actually persistable: `dtu.update` (the real write path,
   `PATCH /api/dtus/:id`) supports `title`/`content`/`creti`/`tags`
   (full-array replace)/`tier` (admin-role-gated) — **no `status`/archived
   field exists on the DTU model at all**, and there is no bulk citation-
   registration macro (`registerCitation` in `server/economy/royalty-cascade.js`
   has exactly one call site, inside `dtu.create`'s own authoring flow — no
   general-purpose "cite an arbitrary existing DTU" endpoint a bulk tool
   could safely call, and citation carries consent + royalty-cascade
   implications CLAUDE.md marks as constitutional). **Fix**: two-phase
   preview→apply flow. `tag`/`untag`/`tier` now genuinely persist — after
   the preview, an "Apply N changes to the substrate" button calls
   `lensRun('dtu','update',...)` per affected DTU (computing the next tags
   array from the real corpus, or setting `tier` directly — server-side
   admin gating on tier changes surfaces as a real per-item failure, not
   silently ignored). `cite`/`archive` stay preview-only, each with an
   inline reason shown in the UI (no substrate field / no consent-checked
   bulk write path) — an honest relabel, not a silent gap.

3. **🟡 `CompareMergePanel`'s merge result read `"Merged X into Y (union)"`
   in past tense with a "Keep X, tombstone Y" line — again nothing was
   persisted.** `dtus.mergeDtus` only ever computed a merged-record preview;
   there is no tombstone/soft-delete field on the DTU model (confirmed
   against `dtu.update`'s field list), so an automatic "merge" would have
   needed either a new backend concept or a silent hard delete. **Fix**:
   relabeled the block "(preview — not yet saved)" and added two real,
   separately-confirmed, explicit actions instead of one implicit one:
   "Save merged as new DTU" (`lensRun('dtu','create',...)` — a genuinely
   new DTU, safe) and "Delete duplicate" (`lensRun('dtu','delete',...)`,
   gated behind a native `confirm()`, clearly labeled as a hard,
   unrecoverable delete since no soft-delete path exists). The user now
   performs a real merge in two honest, undo-safe-by-design steps instead
   of clicking a button that claimed to have already done it.

4. **🟢 No fabricated/hardcoded data found in any of the 9 components.**
   `CitationGraph`, `FacetedSearchPanel`, `LineageTreePanel`, `LayerEditor`,
   `SavedViewsPanel`, `TrendingDtus` were read in full — every rendered
   number traces to a `lensRun('dtus', ...)` or `lensRun('discovery', ...)`
   call, loading/empty states are real (e.g. `CitationGraph`'s "No citation
   links in the current corpus" only renders when `result.nodes.length===0`
   after a real fetch), and no `Math.random()`/lorem placeholder exists
   anywhere in the tree.

## 3. Durability caveat — ~~honest, not fixed this session (out of edit scope)~~ **CLOSED (2026-07-12, `2232d744`)**

~~`dtus.saveView`/`listViews`/`deleteView` and `dtus.getLayers`/`updateLayers`
persist to `globalThis._concordSTATE.dtusLens` — **process-memory `Map`s
keyed by userId**, per the domain file's own header comment ("survive within
a session"). This is real and works correctly today, but a saved smart
collection or a 4-layer edit overlay is lost on server restart — a genuine
durability gap against the Obsidian/Roam parity target (saved searches and
note edits are expected to be permanent). **Disposition: GENUINELY MISSING
(durability), flagged as a scoped future backend task** — closing it needs a
new migration (e.g. `dtu_saved_views` + `dtu_layer_overlays` tables) and
swapping the Map-backed store in `dtus.js` for DB-backed reads/writes with
the exact same macro I/O contract (zero frontend change required). Not done
this session because migrations are outside this rebuild's permitted file
scope (`server/domains/dtus.js` only, no `server/migrations/*`).~~

**CLOSED (2026-07-12)** — migration 361
(`server/migrations/361_dtu_lens_persistence.js`) adds two real tables:
`dtu_saved_views` (one row per saved view — `id`/`user_id`/`name`/
`created_at` as real columns, `filter_json` as a TEXT blob since the
facet-filter shape is caller-defined) and `dtu_layer_overlays` (one row per
`(user_id, dtu_id)` composite primary key — the natural key mirrors the old
`Map<userId, Map<dtuId, layers>>` shape one-for-one, with each of the 4
layers as its own TEXT column so a partial edit doesn't need a JSON round
trip). `server/domains/dtus.js`'s `saveView`/`listViews`/`deleteView` and
`getLayers`/`updateLayers` now read/write through a db-or-memory `store(ctx)`
facade (`dbStore`/`memStore`, the same pattern `domains/tournaments.js`/
migration 360 and `domains/saved.js`/migration 356 use): when `ctx.db` is
present and both tables exist, every macro is durable and survives a
restart; the legacy in-memory `dtusLens` Maps remain only as the fallback
for minimal/test builds with no DB handle, so the existing 22 macro-level
tests in `dtus-domain-parity.test.js` (which construct a bare `ctx` with no
`db`) keep passing unmodified against the same code path they always
exercised. All 5 macros' response shapes are byte-identical — only the
storage layer changed; none of the file's other macros (lineage/quality/
citation-network/tier-recommendation/duplicate-detection/citationGraph/
facets/facetedSearch/lineageTree/bulkOp/compareDtus/mergeDtus) were touched.
New regression coverage in `server/tests/dtus-persistence.test.js` (12
tests) proves the persistence is real by querying `dtu_saved_views`/
`dtu_layer_overlays` directly via raw SQL (not through the macros' own
readers), by opening a second independent `better-sqlite3` handle on the
same file (restart-equivalence), by proving per-user scoping holds in the
DB (no cross-user leakage on list/delete/overlay-read), and by proving the
50-saved-view cap enforces against the real DB-backed count.

## 4. Security-adjacent finding — flagged, not acted on (route file out of scope)

`server/routes/dtus.js` exposes `GET /api/dtu/:id/export` (packs a DTU into
a portable `.tar.gz` container via `packDTUContainer`) and `GET
/api/dtu/:id/verify-container` — a real, complete, Obsidian-style "export
this note" feature with **zero frontend callers anywhere** (`grep -rn
"verify-container\|/api/dtu/.*export" concord-frontend/` → no results).
Investigated wiring it into this rebuild (it's a natural DTU-browser
feature), but both routes resolve the target via `dtusArray()`
(`server.js:14468` — `Array.from(STATE.dtus.values())`, **no per-user
visibility/ownership filter**), unlike the scope-respecting
`userVisibleDTUs(userId)` used elsewhere in the same file. As written,
**any authenticated caller can export or verify any other user's DTU by
id**, including personal-scope ones. `server/routes/dtus.js` is not in this
rebuild's permitted edit scope (only `server/domains/dtus.js`,
`app/lenses/dtus/page.tsx`, `components/dtus/*`), so the responsible
disposition is: **do not add a UI entry point that would spotlight/
encourage use of a route with an unresolved visibility gap** — flagged here
for a dedicated fix (add the same `userVisibleDTUs`-style ownership check
`routes/dtus.js`'s other endpoints already use), not silently routed around
or quietly wired anyway.

## 5. Files touched

- `server/domains/dtus.js` — dual calling-convention fallback (`params` →
  `artifact.data` → `artifact.meta` → `artifact.id`/`.title`) added to all 5
  single-DTU analysis handlers (`lineageAnalysis`, `qualityScore`,
  `citationNetwork`, `tierRecommendation`, `duplicateDetection`). No macro
  removed, no tier/threshold/formula changed — purely input-resolution
  robustness so the handlers work correctly under the virtual-artifact
  calling path this lens actually uses. Backward compatible: 47/47
  pre-existing contract tests pass unchanged.
- `concord-frontend/app/lenses/dtus/page.tsx` — replaced the broken
  `useRunArtifact('dtus')`/`STATE.lensArtifacts`-dependent dispatch and its
  dead `useLensData('dtus','dtu',...)` fallback with `lensRun('dtus', action,
  input)` + a new `buildComputeActionInput()` helper deriving real input
  from the loaded corpus; added a visible current-target indicator and
  disabled state to the Compute Actions panel.
- `concord-frontend/components/dtus/BulkOpsPanel.tsx` — two-phase preview/
  apply flow; `tag`/`untag`/`tier` now genuinely persist via `dtu.update`;
  `cite`/`archive` explicitly labeled preview-only with the reason why.
- `concord-frontend/components/dtus/CompareMergePanel.tsx` — merge result
  relabeled as an unsaved preview; added real "Save merged as new DTU"
  (`dtu.create`) and "Delete duplicate" (`dtu.delete`, confirmed) actions.
- `concord-frontend/components/dtus/KnowledgeWorkbench.tsx` — one-line
  change passing `corpus` through to `BulkOpsPanel` (needed for the tag/
  untag apply step to compute each DTU's next tag array).

**Untouched (confirmed already real, no changes needed):**
`CitationGraph.tsx`, `FacetedSearchPanel.tsx`, `LineageTreePanel.tsx`,
`LayerEditor.tsx`, `SavedViewsPanel.tsx`, `TrendingDtus.tsx`.

## 6. Verification

- `cd concord-frontend && npx eslint app/lenses/dtus/page.tsx
  components/dtus/*.tsx` — clean, 0 errors/warnings.
- `node --check server/domains/dtus.js` — syntactically valid.
- `cd server && node --test tests/dtus-domain-parity.test.js` — 22/22 pass.
- `cd server && node --test tests/dtu-quality-scoring.test.js` — 25/25 pass
  (the qualityScore contract suite most affected by the fallback-chain
  edit; every assertion — content/metadata/citation/freshness boundaries,
  grade thresholds, envelope shape — is unchanged).
- Manually re-derived the exact request/response path for the 5 previously-
  broken Compute Actions buttons against `server.js`'s `/api/lens/run` and
  `/api/lens/:domain/:id/run` handlers (§2 finding 1) — did not require a
  live server boot; the double-wrap/`STATE.lensArtifacts` root cause is
  provable by direct code reading of `register("lens","run",...)` at
  `server.js:38269` vs. the `LENS_ACTIONS` virtual-artifact path at
  `server.js:39558-39564`.
- Did not run project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, or
  `grade-ux-polish.mjs` (reserved for the orchestrator's single end-of-wave
  pass across all 5 concurrently-edited lenses, per instructions).
