# Foundry scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/foundry.js` (+ `foundry-systems.js`, `server/lib/foundry/*`, `server/lib/foundry-publisher.js`, `concord-frontend/app/lenses/foundry/page.tsx`, `components/foundry/*`, `lib/foundry/api.ts`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for the Concord live lens audit (Foundry lens), especially which actions are paid / GPU / public.

## Model — builder macros + separate UGC publisher + world-runtime systems

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Worlds front door** | `FoundryWorldsPanel.tsx` (create / list / delete drafts) | `POST /api/lens/run { domain:'foundry', name:'create'\|'list'\|'delete'|… }` via `lensRun` | SQLite `foundry_worlds` (migration 191); creator-scoped (`creator_id`) |
| **Canvas builder** | `FoundryCanvas.tsx` + `ComponentPalette` + `ConfigPanel` + `FoundryRulesPanel` + `FoundryPreview` | same `/api/lens/run` foundry macros via `lib/foundry/api.ts` | Same `foundry_worlds.worldspec_json`; publish/preview also write `worlds` rows |
| **Builder Studio** (7 tabs) | `BuilderStudio.tsx` | foundry Phase-8 macros + **cross-domain** `game-design.building-publish` | Aux state in `foundryState()` (`globalThis._concordSTATE`: blueprints, playtests, assets, ratings, analytics, collaborators, presence) + worldspec patches |
| **Tooling** | `WorldBuilderRepos.tsx` | `repos.github-topic-search` + optional `SaveAsDtuButton` | External GitHub read; DTU mint if Save pressed |
| **UGC publisher (parallel path)** | **Not wired in Foundry UI components** (HTTP only) | `POST /api/foundry/world/publish` → `publishUgcWorld` (`foundry-publisher.js`) | Writes `content/world/usergen-<slug>/` + `ugc_worlds` status=`active` |
| **foundry-systems.js** (out of builder scope) | Consumed at **play time** inside World lens | domains `size` / `skill_affinity` / `status` / `reincarnation` | Reads published `worlds.rule_modulators` — **not** Foundry builder QA |

### Shared runtime facts

- Primary surface is **macro-only** via `/api/lens/run` (`api.ts:87`; `foundry.js` registers 38 `"foundry"` macros). Creator gate: `ctx.actor.userId || ctx.actor.id` on every write; `list`/`get`/`update`/`delete` are owner-scoped (`foundry.js:157–158,205–212,250–257,268–276,290–297`).
- `foundry` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775`).
- `foundry` is **NOT** in `FRONTEND_ARTIFACT_TYPES` (`lens-artifact-types.js:21–64`) — the page's `useLensData('foundry','foundry_world',{noSeed:true})` is an exhaust counter only (`page.tsx:43`; `FoundryWorldsPanel.tsx:59`). Real CRUD does **not** go through generic `lens.create` / `_lensEmitDTU` (so **FIX-xl-ws-001 does not apply** to `foundry.create` itself).
- Publish inserts a first-class `worlds` row with `status='active'` (`foundry.js:394–407`) and flips `foundry_worlds.status='published'` — discoverable via `foundry.marketplace` (`:1068–1102`).
- Preview/playtest insert `worlds` rows with `status='preview'` (`:649–657`, `:883–886`); `preview_end` / `playtest_end` delete them; heartbeat `foundry-preview-cleanup` sweeps orphans older than **2h** (`foundry-preview-cleanup.js:18–38`; `server.js:34054–34060`).
- `foundry.promote` writes a real `content/world/<publishedWorldId>/` directory (`promote.js` via `:560–573`) — filesystem / repo-adjacent global state. **No Foundry UI button found** that calls it; still reachable as a macro.
- Parallel UGC path `POST /api/foundry/world/publish` (`server.js:67276–67280`) writes `content/world/usergen-*` and lists publicly via `GET /api/foundry/worlds`. **Not referenced from `components/foundry/`.**
- Adjacent (not Foundry UI, same server neighborhood): `POST /api/world-marketplace/lease` (`server.js:67302–67307`) — tenancy/lease; **BLOCKED** if encountered.
- No credit / billing / GPU / training / agent-deploy macros in `foundry.js` (grep clean aside from `promote` name collision). `compose_rule` may call `ctx.llm.chat` when enabled (`:706–715`) with deterministic fallback — **included AI OK**; stop if any cost UI appears.
- Seeds: Worlds panel / Canvas start empty; templates are file-driven reads (`content/foundry-templates/`, 4 on disk).

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/foundry/page.tsx:36–57` via `useLensCommand`:

| Key | Action |
|-----|--------|
| `1` | Worlds view |
| `2` | Builder studio view |
| `3` | Tooling view |
| `n` | Jump to Worlds (`setView('worlds')` only — does **not** create) |

**RC1: YES — bare-letter `n`.** Digits `1`/`2`/`3` can also steal when typing numbers (Builder Studio dimensions / positions / multiplayer counts). `useLensCommand` skips form fields unless `global` (`hooks/useLensCommand.ts:43–49,147–154`) — still the same RCA class when the guard fails.

**RC2: NO** in Foundry-specific components — `rg role="button"` over `components/foundry/` is empty. No modal backdrop Enter/Space close pattern like Field Ops / Security Cases. (LensShell / shared chrome may still have its own patterns — out of this file set.)

**Delete confirm: NONE.** `FoundryWorldsPanel.remove` calls `foundry.delete` immediately (`:92–102`, Trash button `:224–235`). Published rows disable delete in UI (`:227`) matching server `world_published` gate (`foundry.js:298–300`).

## Misleading CTA

`page.tsx:80`: CTA **Create a world** → `setView('worlds')` only (same genus as Environment "Log a site" / Security "Open a case"). Hotkey `n` does the same. Real create = Worlds panel name input + **Create world** submit (`FoundryWorldsPanel.tsx:134–156`) or Canvas **Save** which can `createWorld` (`FoundryCanvas.tsx:155–168`).

## Verdict table — builder macros (user-visible)

| Action | Bucket | Delete / reverse | Side effects | Verdict |
|--------|--------|------------------|--------------|---------|
| **systems / system_schema / validate_systems / templates / blueprint_kinds / asset_kinds / matchmaking_modes / collab_roles** | read-only | n/a | Catalog / vocabulary | **SAFE_READ** |
| **list / get** | read own | n/a | Creator-scoped | **SAFE_READ** |
| **create** (Worlds panel / Canvas Save-as-new) | **(a) SAFE private** | **Yes** `delete` (draft only) | Inserts `foundry_worlds` status=`draft`; **no** `_lensEmitDTU` | **SAFE_PRIVATE_DELETABLE** |
| **update** (Canvas Save, multiplayer_set, compose_rule+id) | **(a)** | via later delete of draft | Owner worldspec / name / description patch | **SAFE_PRIVATE** (delete draft after) |
| **validate** | compute | n/a | No persist | **SAFE_READ** |
| **delete** (draft) | **(e) destructive** but own private | n/a | Hard delete row; blocked if published | **OK as cleanup** of own QA draft; **no confirm** |
| **publish** | **(d) PUBLIC** | unpublish (archive/delete worlds row) | Inserts live `worlds` status=`active`; marketplace-listable; Concord Link anchor best-effort | **BLOCKED-by-policy** |
| **unpublish** | **(d)/(e)** | — | Deletes or archives shared `worlds` row; clears published_world_id | **BLOCKED** (only needed after a forbidden publish) |
| **promote** | **(d)+(e)** irreversible FS | force re-promote only | Writes `content/world/<id>/` on disk; sets `promoted=1` | **BLOCKED-by-policy** (no UI, still macro) |
| **preview / preview_end** | **(d) global `worlds` row** (status=`preview`) | **Yes** `preview_end` (+ 2h sweep) | Transient shared-table insert | **KEEP_BLOCKED** prefer skip — residual orphan risk if tab crash before end |
| **playtest_start / reload / end** | same as preview | **Yes** `playtest_end` | Preview world + in-memory session | **KEEP_BLOCKED** prefer skip |
| **compose_rule** | **(a)** + optional included LLM | rule Trash is client-side until Save; server append when `id` set | May call `ctx.llm.chat` (`:706–715`); fallback deterministic | **SAFE_PRIVATE** on own draft; stop if cost appears |
| **blueprint_get / blueprint_save** | **(a)** | overwrite / abandon (in-memory `foundryState`) | No disk; process-memory | **SAFE_PRIVATE** (ephemeral across restarts) |
| **asset_import / asset_list / asset_remove** | **(a)** | **Yes** `asset_remove` | URL metadata in `foundryState.assets` | **SAFE_PRIVATE_DELETABLE** (URL only — do not import non-QA remote assets that pull PII) |
| **multiplayer_get / multiplayer_set** | **(a)** | via draft delete / overwrite | Clamped into worldspec; activates only after **publish** | **SAFE_PRIVATE** on draft |
| **marketplace** (read) | read of **others' published** games | n/a | Lists all `status='published'` foundry worlds | **SAFE_READ** (browse only) |
| **rate** | **(d) shared/public** | overwrite own rating only | Shared `foundryState.ratings`; visible in marketplace aggregates; cannot rate own | **BLOCKED-by-policy** |
| **ratings** (read) | read | n/a | Includes other users' reviews (`userId` + text) | **SAFE_READ** (inspection) |
| **track_play** | **(d) shared analytics** | no | Mutates shared analytics buckets | **BLOCKED-by-policy** |
| **analytics** (read own) | read | n/a | Creator/collaborator scoped | **SAFE_READ** |
| **collab_add** | **(d) invite / share** | collab_remove | Grants editor/viewer to another `userId` | **BLOCKED-by-policy** |
| **collab_remove / collab_list / collab_ping** | roster / presence | — | Presence is shared to collaborators | **list/ping OK on own world**; **add BLOCKED**; remove only to undo a blocked add |
| **Place building** (`game-design.building-publish` from Assets tab) | **(d) marketplace-capable DTU** + world spawn | no in-UI delete | Mints DTU with `license.scopes: ["private","marketplace_sale"]` (`gamedesign.js:2202`); inserts `world_buildings`; UI passes Foundry `fw_*` id as `worldId` (`BuilderStudio.tsx:550–556`) | **BLOCKED-by-policy** |
| **SaveAsDtu** (Tooling) | private DTU default | DTU library delete if available | Defaults `licenseScopes=['private']` (`SaveAsDtuButton.tsx:169`); still generic DTU mint → **FIX-xl-ws-001** if via `dtu.create` | **Prefer skip** / KEEP_BLOCKED if WS title leak unacceptable |
| **POST /api/foundry/world/publish** (UGC) | **(d)+(e)** FS public world | not in UI | `content/world/usergen-*` + `ugc_worlds` active | **BLOCKED-by-policy** |
| **foundry-systems.*** (size/status/…) | play-time runtime | n/a | Needs published/preview world + player | **Out of builder QA scope** — do not drive from Foundry |

### Paid / GPU / credits

**None found** on the Foundry builder macro surface. No billing hooks, GPU jobs, fine-tunes, agent deploys, or code-execution macros in `foundry.js` / `components/foundry/`. `compose_rule` LLM is the only inference path (included chat; stop on cost). Adjacent `world-marketplace/lease` is **not** Foundry UI but is a tenancy/lease surface — treat as **BLOCKED** if reached.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| **foundry.create → draft world** | Worlds panel: name `QA LT3 foundry 2026-11-09 <thing>` → Create world → Trash delete. Or Canvas Save on a new unsaved canvas then delete from Worlds list. |
| **update / validate / templates / systems / multiplayer_set / blueprint_save / asset_import+remove / compose_rule** | Only against that own QA draft. Delete draft when done. |
| **marketplace / ratings / analytics / systems reads** | Read-only OK. |

## Keep BLOCKED / do not write

1. **Publish / Unpublish** — creates/destroys live shared `worlds` rows + marketplace listing (`foundry.js:357–494`; Canvas Publish/Unpublish `:179–228,378–391`).
2. **Promote** — filesystem write under `content/world/` (`:524–584`).
3. **UGC `POST /api/foundry/world/publish`** — public usergen world on disk (`foundry-publisher.js:28–95`).
4. **Rate / track_play** — shared ratings & analytics (`:1112–1194`).
5. **collab_add** — grants another user access (`:1223–1237`).
6. **Preview / Playtest** — prefer skip (shared `worlds` status=`preview`; orphan until end or 2h sweep).
7. **Place building / building-publish** — marketplace_sale-scoped DTU + `world_buildings` insert.
8. **SaveAsDtu** on Tooling — prefer skip (DTU mint / FIX-xl-ws-001).
9. LensShell Publish/share, emails, SMS, payments, agent deploy, paid Ask — standing rules.
10. Do **not** enter real third-party userIds into Collab, real remote asset URLs with private content, or publish QA worlds under non-QA names.

## Validation / form test hints

- **create**: `name` required, trim, max 200; empty → `missing_name`; `description` sliced to 2000 (`foundry.js:160–163`).
- **publish hard-gate**: `validateWorldspec` must `ok` + `systems.length >= 1` (`:379–386`); Canvas disables Publish until `canPublish` (`FoundryCanvas.tsx:303`).
- **preview**: rejects empty systems (`:621–623`); does **not** hard-gate validation (half-built OK).
- **compose_rule**: NL required, max 500 (`:699–701`).
- **rate**: stars 1–5 int; `cannot_rate_own_game`; must be published (`:1122–1125`).
- **multiplayer_set**: `badNumericField` on min/max/lobby/team; `min_exceeds_max` (`:1038–1051`).
- **blueprint_save**: `empty_blueprint` if no nodes (`:843`).
- **asset_import**: `validateAsset` errors (`:964–965`).
- **delete**: `world_published` if still published (`:298–300`).
- **RC1**: when typing the create-name field or Canvas name/description, watch for accidental `n` / digit tab switches.
- **No RC2** on Foundry modals; Space/Enter in name field should submit the create **form** normally (`onSubmit` `:137`) — that is intentional form submit, not RC2.

## Gaps / notes

- Two publish pipelines: overlay `foundry.publish` (UI) vs UGC `foundry-publisher` (HTTP-only). Both public; both BLOCKED.
- Canvas and Worlds panel can each create drafts — two entry points; delete only from Worlds list UI (Canvas has no Delete button; published must unpublish first).
- Aux Phase-8 state (blueprints/assets/ratings/collab) lives in process memory (`foundryState`) — survives until process recycle; draft row delete does **not** clear those Maps (orphan aux keyed by foundry world id).
- `building-publish` from Foundry passes `fw_*` as `worldId` — may fail overlap/world checks or attach buildings to a non-`worlds` id; either outcome is still a marketplace-capable DTU mint → keep blocked.
- Live not proven: production `foundry_worlds` / preview orphans for the shared QA account; whether LLM path is enabled for `compose_rule`; whether any prior published QA worlds already exist.

## Summary for tester

**OK for one QA call + delete** (title `QA LT3 foundry 2026-11-09 …`): create draft world; update / validate / add systems / templates / multiplayer_set / blueprint_save / asset_import+remove / compose_rule on that draft; read marketplace/ratings/analytics/systems. **Delete the draft when done** (Trash; no confirm).

**BLOCKED-by-policy:** Publish, Unpublish, Promote, UGC `/api/foundry/world/publish`, Rate, track_play, collab_add, Place building / building-publish, SaveAsDtu (prefer), Preview/Playtest (prefer skip).

**No paid/GPU/credit actions** on this lens builder surface. **RC1 bare-letter `n` (+ digits 1–3).** **RC2 not present** in Foundry components. Deletes have **no confirm**.

Code-only verdict; not live-proven.
