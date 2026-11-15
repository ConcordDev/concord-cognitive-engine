# Entity scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/entity.js` (+ `server/lib/entity-substrate.js`, `server/domains/worldmodel.js`, `server/server.js` worldmodel + entity.terminal macros ~17214–17480 / ~16180–16576 / createWorldEntity ~81340–81395, `concord-frontend/app/lenses/entity/page.tsx`, `components/entity/*`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for Lens Tester 4 after claiming `entity` (criteria/entity.md). Creates held until this answer — especially whether entities are per-user or a shared global graph, whether creates/edits/merges/links touch other users' data, and whether public/DTU emits, AI, or paid/GPU work fire.

## Model — two planes (private knowledge-graph DTUs + shared world-model Registry)

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Graph workbench (preferred QA)** | Entity page → Graph tab → `KnowledgeGraphWorkbench.tsx` | `POST /api/lens/run { domain:'entity', action:'node-create'\|'node-update'\|'node-delete'\|'edge-*'\|'schema-*'\|'node-merge'\|'node-split'\|'import-*'\|'graph-get'\|… }` | Per-user DTUs in `STATE.dtus`: `machine.kind="entity-node"` / `"entity-schema"`, `privacy:"private"`, `scope:"user"`, `author=userId` (`entity-substrate.js:7–18,70–87`). Legacy `STATE.entityGraph` Maps migrate idempotently on first `graph-get` (`entity.js:748–754`, `entity-substrate.js:280–317`). Key `entityGraph` is in `LENS_STATE_KEYS` (`lens-state-persistence.js:226`) |
| **Registry (world-model desk)** | Entity page → Registry tab (default) → `SwarmRegistryPanel` / `EntityInspector` / `WorldOverview` | `lensRun('worldmodel', …)` via `wm()` (`entity-model.ts:125–131`) → `register("worldmodel","create_entity"\|"update_entity"\|"delete_entity"\|"list_entities"\|"create_relation"\|"simulate"\|…)` (`server.js:17214–17480`) | **Shared global** `STATE.worldModel.entities` / `.relations` / `.simulations` / `.snapshots` Maps (`server.js:81298–81330,81391`). `list_entities` returns **all** entities (no owner filter) (`:17256–17277`, `{ public: true }`) |
| **Wikidata import** | Wikidata tab → `WikidataSearch.tsx`; Graph Import tab | Public `wikidata-search` lookup + `entity.import-wikidata` → private graph node | External Wikidata read; node lands on **owner-scoped** entity-node DTU |
| **Minds** | Minds tab → `MindsPanel` | Emergent substrate status poll | Read-only display of emergent entities (no QA create surface found in panel) |
| **Agents** | Agents tab → `AgentStatusPanel` | `apiHelpers.agents.status` / `spawnResearch` | Research **agent spawn** — separate agents subsystem |
| **Terminal (council-gated)** | Registry inspector Terminal tab | `entity.terminal` / `terminal_approve` / `terminal_pending` (`server.js:16180+`) | Shell exec in `DATA_DIR/entity_workspaces/<userId>` when `ENABLE_TERMINAL_EXEC=true` |

### Shared runtime facts

- Entity domain registers analytic macros (`entityResolution`, `relationshipGraph`, `attributeValidation`) plus the workbench set (`graph-get`, `node-*`, `edge-*`, `schema-*`, `node-merge`, `node-split`, `path-find`, `import-bulk`, `import-wikidata`, `provenance-report`) in `entity.js` (loaded via `server/domains/index.js`). Actor helper: `aid(ctx) = ctx?.actor?.userId || ctx?.userId || "anon"` (`:746`). Writes wrapped with `guardAnonWrites` (`:14`).
- **Graph plane is per-user.** `listNodes` / `getNode` / `putNode` / `deleteNode` / edges / schemas all filter `authoredBy(dtu, userId)` (`entity-substrate.js:51–52,90–125`). `node-merge` / `edge-create` only resolve ids inside the caller's own graph (`entity.js:843–851,926–930`) — **cannot** merge or link another user's nodes.
- **Registry plane is a shared global graph.** `create_entity` stamps `source.createdBy` from the authenticated actor (`server.js:17216–17219,81378–81381`). `update_entity` / `delete_entity` gate on that owner (or admin) when `AUTH_MODE !== "public"` (`:17419–17480`). But **`list_entities` / `get_entity` / `list_relations` are `{ public: true }` and unscoped** — every signed-in (and public-mode) caller sees every entity. Creating a Registry entity **publishes its name/type/salience into the shared catalog**. `create_relation` links any two ids in that global Map with **no ownership check** (`:17222–17224` → `createWorldRelation` `:81398+`).
- `entity` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775`).
- `entity` domain is **NOT** in `FRONTEND_ARTIFACT_TYPES` (`lens-artifact-types.js:21–63`). Closest entry is `"graph": ["entity"]` (different domain). Main Graph/Registry creates do **not** go through generic `lens.create`.
- **FIX-xl-ws-001 / `_lensEmitDTU`:** Graph `node-create` / `putNode` write `STATE.dtus` directly (`entity-substrate.js:113–119`) — **no** `_lensEmitDTU`. Worldmodel `create_entity` writes `STATE.worldModel.entities` directly (`server.js:81391`) — **no** `_lensEmitDTU`. Prefer-skip: Wikidata tab `SaveAsDtuButton` (generic DTU mint) and any LensShell Publish/share chrome.
- Caps (Graph): 5000 nodes, 10000 edges, 200 schemas per user (`entity.js:759`). Bulk import slices to 2000 rows (`:1097`). Worldmodel has `config.maxEntities` / `maxRelationsPerEntity` / `maxSimulationSteps` (`:81344,81420,17396–17407`).
- Seeds: none for the Graph workbench. Registry may already contain system/other-user entities from prior traffic.

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/entity/page.tsx:50–68` via `useLensCommand`:

| Key | Action |
|-----|--------|
| `1`…`5` | Switch Registry / Minds / Graph / Wikidata / Agents |
| `n` | **Spawn entity** (opens Registry create form) |

**RC1: YES — bare-letter `n` and bare digits `1`–`5`.** Commands do not set `global`. `useLensCommand` skips INPUT / TEXTAREA / SELECT / `contentEditable` unless `global` (`hooks/useLensCommand.ts:43–49,147–154`) — guard *should* hold while typing Spawn name / Graph fields; still the same RCA class when the guard fails.

**RC2: NO** in entity-specific components — `rg role="button"` over `app/lenses/entity/` + `components/entity/` is empty for that pattern.

**Delete confirm:** Graph node/edge/schema deletes are one-click in the workbench UI (no `window.confirm` found). Registry `delete_entity` likewise one-click from inspector. Prefer careful QA naming + immediate cleanup.

## Answers to the specific questions

### Are entities per-user or a shared global graph?

**Both, by tab.**

1. **Graph tab (knowledge-graph workbench) = per-user / private.** Owner-scoped entity-node / entity-schema DTUs. Merges and links stay inside the caller's graph.
2. **Registry tab (world-model) = shared global graph.** One process-wide `worldModel.entities` Map; `list_entities` exposes everyone's entities; relations are global.

### Do creates, edits, merges or links touch other users' data or shared/global records?

| Surface | Touches others / shared? |
|---------|--------------------------|
| Graph `node-create` / `node-update` / `node-delete` / `edge-*` / `schema-*` / `node-merge` / `node-split` / `import-bulk` / `import-wikidata` | **No** — author filter on every read/write; merge only own ids |
| Registry `create_entity` | **Yes — shared catalog.** New row visible to all via `list_entities` |
| Registry `update_entity` / `delete_entity` | Own (or admin) only — **but** operating inside the shared Map; do not edit/delete others' rows |
| Registry `create_relation` | **Yes — can link any global ids** (including other users' entities); mutates shared relation store |
| Registry `simulate` / `counterfactual` / `snapshot` | Read/derive over the **shared** graph; snapshot appends to shared `worldModel.snapshots` |

### Public / DTU emits (incl. `_lensEmitDTU` / FIX-xl-ws-001), AI, paid / GPU?

| Path | `_lensEmitDTU` | Other broadcast / public | AI / paid / GPU |
|------|----------------|--------------------------|-----------------|
| Graph node/edge/schema CRUD + merge/split/import | **No** | None | None in domain handlers |
| Registry create/update/delete/relate | **No** | Shared list visibility (not a WS exhaust, but **public-catalog shaped**) | `simulate` / `counterfactual` are local world-model math in `server.js` — no LLM/GPU hook found on those macros |
| Wikidata search | n/a | External public lookup | Free Wikidata API via `publicLookup` — not paid Concord AI |
| `SaveAsDtu` on Wikidata results | Generic DTU mint (FIX-xl-ws-001 class) | Prefer skip | n/a |
| Agents `spawnResearch` | n/a | Agent deploy | **BLOCKED** |
| `entity.terminal` | n/a | Shell exec in user workspace | **BLOCKED** (disabled unless `ENABLE_TERMINAL_EXEC`; still agent/exec-shaped) |

**Verdict for FIX-xl-ws-001:** does **not** apply to Graph `node-create` or Registry `create_entity`. Still treat Registry creates as **shared/global** under the private-fixture policy.

## Misleading / adjacent CTAs

- FAB / hotkey **Spawn entity** → Registry `create_entity` into the **shared** world model — looks private; is catalog-visible. **BLOCKED** for QA writes.
- Graph **New node** / Import / Merge / Split → real private graph — honest; **preferred QA**.
- Wikidata **Import to graph** → private node — OK if deleted after; **SaveAsDtu** → prefer skip.
- Agents **Spawn research agent** → agent deploy — **BLOCKED**.
- Inspector **Terminal** → shell exec / council gate — **BLOCKED**.
- Registry **Fork**, **Relate** to non-QA entities, **Simulate** / **Snapshot** on the shared graph — prefer skip / BLOCKED when they touch others' rows or append shared snapshots.

## Verdict table — entity actions (user-visible)

| Action | Bucket | Delete / reverse | Side effects | Verdict |
|--------|--------|------------------|--------------|---------|
| **graph-get / schema-list / path-find / provenance-report** (own) | read | n/a | Owner-scoped | **SAFE_READ** |
| **node-create / node-update / edge-create / schema-save / node-split / import-bulk / import-wikidata** | **(a) SAFE private** | **Yes** `node-delete` / `edge-delete` / `schema-delete` | Per-user DTUs; **no** `_lensEmitDTU` | **SAFE_PRIVATE_DELETABLE** |
| **node-merge** (own → own) | **(a)** | n/a (destructive merge) | Only own nodes; deletes source | **SAFE_PRIVATE** (own QA nodes only; label clearly) |
| **node-delete / edge-delete / schema-delete** | **(e) destructive** but own | n/a | Owner-scoped | **OK as cleanup** |
| **list_entities / get_entity / list_relations / status** (worldmodel) | read shared | n/a | Sees **all** entities | **SAFE_READ** (do not treat listed foreign rows as fixtures) |
| **create_entity** (Registry Spawn / Fork) | **(d) shared global catalog** | `delete_entity` if owner | Visible to every `list_entities` caller | **BLOCKED-by-policy** |
| **update_entity** on own Registry row | shared-store write | delete | Still in global Map | **BLOCKED-by-policy** (prefer Graph for QA writes) |
| **delete_entity** on own Registry row | cleanup of shared row | n/a | Removes from global Map + should clean relations | Prefer only if cleaning a prior accidental Spawn; do not create new ones |
| **create_relation** / relate in inspector | **(d) shared links** | `delete_relation` (domain) / inspector | Can link foreign entities | **BLOCKED-by-policy** |
| **simulate / counterfactual / snapshot** | shared derive / shared append | n/a | Runs over global graph; snapshot pushes shared list | **BLOCKED-by-policy** / prefer skip |
| **extract_from_dtu** | may mint Registry entities | delete those entities | Shared catalog pollution | **BLOCKED-by-policy** |
| **SaveAsDtu** (Wikidata) | private DTU default | DTU library delete if available | FIX-xl-ws-001 class mint | **Prefer skip** |
| **agents.spawnResearch** | **(c) agent** | n/a | Research agent deploy | **BLOCKED-by-policy** |
| **entity.terminal / terminal_approve** | **(c) exec / agent** | n/a | Shell in entity workspace; council gate | **BLOCKED-by-policy** |

### Paid / GPU / credits

- **No** billing hooks, credit burns, fine-tunes, or GPU vision jobs found on Graph or Registry CRUD.
- Wikidata = public upstream lookup (not Concord paid AI).
- Agents spawn / Terminal exec = **BLOCKED** (agent / code-execution), not "included AI chat".
- Standing rule: included AI OK elsewhere; **stop if any cost UI appears**. None wired on the preferred Graph path.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| **Graph → New node** | Title/name `QA LT4 entity 2026-11-09 <thing>` → create → optional edge between own QA nodes → later **node-delete**. **Preferred.** |
| **Graph import-bulk / import-wikidata** | Same prefix; delete imported nodes after. |
| **node-merge / node-split** | Only on own QA nodes created this session. |
| **graph-get / path-find / provenance-report / schema-*** | Read/write on own graph OK. |

**Delete path exists** on the Graph plane (`node-delete` / `edge-delete` / `schema-delete`) → Graph creates are **not** KEEP_BLOCKED for cleanup reasons.

**Registry Spawn is NOT private** → do **not** treat deleteability as enough; policy requires private fixtures.

## Keep BLOCKED / do not write

1. **Registry Spawn entity / Fork** — shared global `worldModel.entities` (`server.js:17214–17219,81391`; UI `SwarmRegistryPanel.tsx:102–123`).
2. **create_relation / inspector Relate** across the shared graph — especially to non-QA / other users' entities.
3. **simulate / counterfactual / snapshot / extract_from_dtu** on the shared world model.
4. **Agents → Spawn research agent** (`AgentStatusPanel.tsx:20`).
5. **Terminal** commands / approve (`entity.terminal*`).
6. **SaveAsDtu** on Wikidata results — prefer skip (DTU mint / FIX-xl-ws-001 class).
7. LensShell Publish/share, emails, SMS, payments, paid Ask — standing rules.
8. Do **not** edit or delete other users' Registry entities; do not leave QA rows in the shared catalog.

## Validation / form test hints

- **node-create:** `name required` (`entity.js:781–782`); default `entityType` `"generic"`; attributes accept `{value,source}` or raw values (`:784–792`); `node_cap` at 5000 (`:794`).
- **edge-create:** both endpoints must exist in **own** graph; no self-edge; duplicate `(from,to,relType)` rejected; `edge_cap` at 10000 (`:843–853`).
- **node-merge:** `sourceId` + `targetId` required; cannot merge into self; optional `fieldChoices` (`:926–931`).
- **node-split:** `splitName` required; moves listed `attributeKeys` (`:1003–1008`).
- **schema-save:** `className` required; attribute types limited to string/number/integer/boolean/date/url/email (`:883–887`).
- **import-wikidata:** `wikidataId` + `label` required; duplicate wikidataId refused (`:1130–1137`).
- **Registry create_entity:** name optional (auto-generates); type must be in server `ENTITY_TYPES` (`:81340`); stamped `createdBy` ignored from client input.
- **RC1:** typing Spawn name / Graph node name — watch bare `n` / `1`–`5` if focus guard fails.
- **No RC2** in entity components.
- Persistence (Graph): create → hard reload → still in `graph-get` (DTU + saveStateDebounced). Delete → gone from graph-get.
- Persistence (Registry): would survive in shared Map — **do not create**.

## Gaps / notes

- Two product surfaces under one lens URL; Registry default tab makes the shared graph the first thing testers see.
- `list_entities` being public means prior QA Spawns from any account remain visible — inventory foreign rows as read-only noise, not fixtures.
- Live not proven: whether production `ENABLE_TERMINAL_EXEC` is on; whether agents.spawnResearch bills; whether the shared QA account already has Registry rows or Graph DTUs.

## Summary for tester

**OK for one QA call + delete** (name `QA LT4 entity 2026-11-09 …`):
- **Preferred:** Graph tab → **New node** (`node-create`) → optional own-only edge / attribute edit → reload → **node-delete**.
- Also OK: schema-save + schema-delete; import-wikidata into Graph then delete; node-merge/split only on own QA nodes.
- Optional reads: graph-get, path-find, provenance-report, Registry **list** (expect foreign rows).

**Graph entities are per-user; Registry entities are a shared global graph.** Creates/edits/merges/links on Graph do **not** touch other users. Registry Spawn/Relate/Simulate/Snapshot **do** touch shared/global records — **BLOCKED**. **`_lensEmitDTU` does not fire** on Graph or Registry creates.

**BLOCKED-by-policy:** Registry Spawn/Fork/Relate/simulate/snapshot/extract_from_dtu; Agents spawn; Terminal; prefer-skip SaveAsDtu.

**No paid/GPU on Graph CRUD.** **Delete path exists on Graph** → Graph creates allowed (not KEEP_BLOCKED for cleanup). Registry creates blocked for shared-catalog reasons even though `delete_entity` exists for owners.

**RC1 bare-letter `n` + digits `1`–`5`.** **RC2 not present** in entity components.

Code-only verdict; not live-proven.
