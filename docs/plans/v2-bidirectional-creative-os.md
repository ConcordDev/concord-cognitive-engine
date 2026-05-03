# Concordia v2.0 — Bidirectional Creative OS

## Context

**Why this change.** Today Concordia is a 3D world that lives next to a knowledge platform. The user wants the two to genuinely fuse: real human uploads (medical research, music, blueprints, fighting style sequences) flow into the in-game world and become first-class citizens (NPC doctors learn techniques, soundscapes evolve, blueprints become buildings). NPCs become aware of real human culture by reading public Social Lens posts via "Shadow DTUs." Players accumulate unique personal recipes (private DTUs scoped to their avatar) for fighting styles, spells, and blueprints, and can publish those to a tier-priced marketplace under the existing 95% creator share.

**Scope decision (per user clarification).** Full vision — not phased slices. All three recipe types ship together. All three instantiations (music → soundscape, blueprint → world spawn, medical → NPC knowledge) ship together. UI/UX is updated alongside backend at every surface. Redundancy and safe-by-default behavior on every new path.

## What's already built (reuse, don't reinvent)

- **Personal DTU scope + sovereignty invariant.** `scope='personal'` with critical invariant `personal_dtus_never_leak` at `server/lib/sovereignty-invariants.js:13`.
- **Personal locker** with user-scoped query and existing `/publish` route at `server/routes/personal-locker.js:89,136`.
- **Marketplace with tier pricing** at `server/economy/creative-marketplace.js:99` (already supports e.g. listen=$0/download=$3/remix=$15/commercial=$60 for music).
- **Royalty cascade** — citation-driven 21%→10.5%→5.25%→… → 0.05% floor at `server/economy/royalty-cascade.js:37`. Walks ancestor chain on every sale.
- **Crafting engine** is DTU-keyed already — works on any recipe DTU at `server/lib/crafting/craft-engine.js:26`.
- **Shadow DTU substrate** is fully built at `server/emergent/shadow-graph.js`: pattern shadows, momentum-based promotion, richness-based TTL (14–90 days), 2000 cap. `server/lib/evo-asset/npc-shadow-bridge.js:41` is a working POC of NPCs writing shadows.
- **Soundscape engine + 16 district soundscapes** in `concord-frontend/components/world-lens/SoundscapeEngine.tsx` (built but not initialized on world entry — CLAUDE.md confirms).
- **Building renderer** in `concord-frontend/components/world-lens/BuildingRenderer3D.tsx` (renders DTU 3D models).
- **Oracle brain + narrative bridge** for NPC LLM dialogue at `server/lib/oracle-brain.js`, `server/lib/narrative-bridge.js`.
- **Skill progression** with cross_world_use XP event already defined at `server/lib/skill-progression.js:6`.
- **Combat hotbar** loads combat_skill DTUs at `concord-frontend/lib/concordia/combat/hotbar.ts:131`.
- **Social Lens has privacy field in UI** (`'public'|'friends'|'private'`) at `concord-frontend/app/lenses/timeline/page.tsx:47`.

## What's genuinely missing

1. Combat skills default to `scope='global'` instead of `'personal'` (1-line bug at `hotbar.ts:84`).
2. No `fighting_style_recipe`, `spell_recipe`, `blueprint` DTU type discriminators.
3. No `social-npc-bridge` heartbeat module — public timeline DTUs never reach oracle context.
4. Backend privacy enforcement on timeline DTUs is unclear (UI has the toggle, server may not filter).
5. No `quest-emergence` scheduler (CLAUDE.md confirms).
6. No DTU → world instantiation pipelines (music to soundscape slot, blueprint to world spawn, medical research to NPC knowledge).
7. No "publish personal DTU to marketplace with tier pricing" composed flow (only personal→public substrate exists).
8. No crafting UI on frontend.
9. Redundancy gaps in heartbeat additions (everything must wrap try/catch per CLAUDE.md).

## Plan — five integrated workstreams (ship together)

Each workstream lists backend changes, frontend changes, redundancy/safety, and verification.

---

### Workstream 1 — Personal recipe substrate + marketplace publishing

**Backend**
- `concord-frontend/lib/concordia/combat/hotbar.ts:84` — fix `createCombatSkill()` to set `scope: 'personal'` on the POST body.
- `server/lib/dtu-validators/recipe-validators.js` (new file) — three Zod-style validators:
  - `fighting_style_recipe` shape: `{ moves: [{ comboId, conditions }], stance, signatureSequence, controlScheme }`
  - `spell_recipe` shape: `{ formula, costs: { mana, stamina, ap }, range, targetType, animationClip }`
  - `blueprint` shape: `{ kind: 'building'|'vehicle'|'weapon', dimensions, materials, gltfRef? }`
- `server/server.js` DTU creation route — wire validators by `meta.type`. Default `scope='personal'` for these three types.
- `server/routes/personal-locker.js` — new endpoint `POST /api/personal-locker/dtus/:id/list-on-marketplace`. Body: `{ price, tierPrices? }`. Composes existing `personal-locker.publishDTU()` + `creative-marketplace.publishArtifact()`.

**Frontend**
- New panel `concord-frontend/components/concordia/recipes/RecipeAuthorPanel.tsx` — three-tab create flow (Fighting Style / Spell / Blueprint).
- `concord-frontend/app/lenses/personal-locker/` — extend with "List on marketplace" action calling new route; collects tier-pricing input.
- Hotbar already loads `combat_skill` DTUs; extend to also load `fighting_style_recipe` (it's a sequence of combos, hotbar surfaces it as a "stance").

**Redundancy / safety**
- All three types default to `scope='personal'` and are protected by the existing `personal_dtus_never_leak` sovereignty invariant — automatic privacy.
- Marketplace listing requires explicit user opt-in click (no implicit promotion).
- The existing royalty cascade applies automatically — no new royalty code needed.

**Verification**
- API: create each recipe type → confirm it doesn't appear in another user's `GET /api/personal-locker/dtus`.
- API: list-on-marketplace at `commercial=$60` → buyer purchases → buyer gets license + recipe in their hotbar.
- E2E: author a fighting style in UI → equip → publish → second account finds it in marketplace, buys, equips, uses.

---

### Workstream 2 — Bidirectional awareness loop (Social Lens → NPC)

**Backend**
- New module `server/emergent/social-npc-bridge.js`. Default cadence: every 5 ticks (~5 minutes). Logic:
  1. Query `dtus` where `tags LIKE '%timeline%'` and `data.privacy = 'public'` and `created_at > lastBridgeRun`.
  2. For each, build a Shadow DTU using existing `wireShadowEdges_pattern()` from `shadow-graph.js`. Tag `'social_awareness'`. Set `core.summary` from post text.
  3. For NPCs in worlds matching the post's universe (or all worlds if no universe match), call `recordInteractionFromNPC()` so the shadow influences their behavior model.
- `server/lib/narrative-bridge.js` — extend `enrichOracleContext()` to pull top N (default 5) most recent shadows tagged `'social_awareness'` for the NPC's world/faction; include in LLM prompt context as "Recent cultural signals from the human world."
- Backend privacy enforcement: in the timeline DTU creation route, persist `data.privacy` as a top-level column (or indexed JSON path) so the bridge query is cheap and authoritative.
- Heartbeat wiring in `server/server.js` `governorTick()` — wrapped in try/catch, structured-log on failure.

**Frontend**
- Timeline lens (`app/lenses/timeline/page.tsx`) — surface privacy explicitly on the compose box (it exists in the type but is hardcoded to `'public'` today). Add visual privacy badge on each post.
- Add a small "NPCs are listening" indicator next to the privacy toggle when `'public'` is selected — explains the bidirectional loop to the user.
- New small lens widget: "Recent NPC reactions" showing dialogue snippets that referenced your public posts (when narrative-bridge logs include the source shadow ID).

**Redundancy / safety**
- Bridge module wrapped in try/catch per CLAUDE.md heartbeat rules.
- Privacy default = `'public'` only when user explicitly chooses it; otherwise `'private'` (failsafe direction).
- LLM context-size cap: hard limit on total social-shadow context per oracle prompt (default 1KB) so prompts don't blow out.
- Shadow capacity already capped at 2000 by existing shadow-graph code.

**Verification**
- Post a public message → wait 1 tick → confirm next NPC dialogue prompt includes it (dev-mode log).
- Post a private message → confirm it never appears in any shadow.
- Stress: post 100 messages in a tick → confirm bridge processes them in order without exceeding shadow cap.

---

### Workstream 3 — DTU → world instantiation (all three)

**3a. Music DTU → Soundscape**

- Backend: `server/lib/soundscape-bridge.js` (new) — query DTUs `where core.type='music_track'` and tags overlap district tags; expose `GET /api/world/soundscape/:districtId/tracks` returning the playlist for client-side playback.
- Frontend: initialize `SoundscapeEngine.tsx` on world entry (the existing wiring gap from CLAUDE.md). Wire to the new endpoint; cycle community tracks alongside authored stems.
- XP wiring: when a track plays for a non-author, fire `awardExperience(skillId, 'cross_world_use', ...)` per `skill-progression.js:6`.
- DAW UI: wire piano roll/mixer in `concord-frontend/app/lenses/studio/` to `concord-frontend/lib/daw/engine.ts` (CLAUDE.md notes this is a built-but-unwired path).

**3b. Building blueprint DTU → World spawn**

- Backend: new route `POST /api/world/buildings/spawn` — body `{ blueprintId, position }`. Validates blueprint DTU; creates a `world_buildings` row referencing it; emits `world:building-spawned` realtime event.
- Frontend: extend `BuildingRenderer3D.tsx` (already renders) to read `world_buildings` rows and render the referenced blueprint DTU. Add "Place Blueprint" UI in crafting bench.
- NPC integration: NPCs with `archetype='builder'` may select blueprint DTUs from public/global scope and spawn them autonomously per existing NPC behavior loop.

**3c. Medical research DTU → NPC doctor knowledge**

- Backend: `server/lib/npc-knowledge-bridge.js` (new) — DTUs tagged `'medical'` or `'research'` with a defined skill mapping update an `npc_knowledge` table associating NPCs with healing/diagnostic DTU references.
- Existing `server/lib/oracle-brain.js` consumes this in narrative bridge: NPC doctors mention/reference newly available techniques in dialogue.
- Frontend: hospital interior dialogue panel surfaces a "Recent advancements" list pulled from the new bridge — gives the player a direct readback of community contributions affecting NPCs.

**Redundancy / safety**
- Each instantiation has a feature flag (env var) so any single one can be disabled in production without touching the others.
- DTU instantiation never deletes or mutates the source DTU (preserves DTU substrate invariant).
- All bridge writes are idempotent — re-running on the same DTU is a no-op.

**Verification**
- Music: upload a track tagged `district:plaza` → walk into the plaza district → hear the track. Author gets XP after second user enters.
- Blueprint: upload a small building blueprint → call spawn endpoint → see the building render at given position. NPC builder walks past, references it in dialogue.
- Medical: upload a research DTU tagged `medical` → enter a hospital → NPC doctor mentions the technique in dialogue within one tick window.

---

### Workstream 4 — Crafting UI + recipe marketplace browse

**Frontend**
- Crafting UI in `concord-frontend/app/lenses/crafting/` (new) — consumes `craft-engine.js` via `POST /api/crafting/execute`. Three sub-tabs: My Recipes (personal-scope), Browse Marketplace (public + listed), Author New (calls Recipe Author Panel from Workstream 1).
- Marketplace lens (existing) — add "Recipes" category surfacing the three new types with filter tabs.
- Loadout view: extend hotbar UI to show personal vs. published-derivative provenance on each slot.

**Redundancy / safety**
- All recipe usage that triggers a sale uses existing `royalty-cascade.distributeRoyalties()` — no parallel logic.
- Crafting validation already enforces resource and skill checks at engine level.

**Verification**
- Author personal fighting style → equip → use in combat → progresses XP → publish to marketplace at remix=$15 → second account browses, buys, gets license, equips. First account receives 95% share; subsequent derivative sales cascade royalties.

---

### Workstream 5 — Quality scaffolding (parallel-track plumbing)

- Heartbeat scheduler module: extract a small registry pattern in `server/emergent/module-registry.js` so adding new heartbeat modules (social-npc-bridge, quest-emergence-scheduler, etc.) is a one-line registration, not direct edits to `governorTick()`. Reduces accidental break of existing modules.
- Quest emergence scheduler: register an existing `detectQuestOpportunities()` call into the new registry at every-20-tick frequency (closes the CLAUDE.md gap).
- Combat combo evolver scheduler: register `evolveFighterCombos()` at every-10-tick frequency (currently emergent but not on schedule).

**Verification**
- New modules show up in `module-registry.js` listings; every existing tick continues to fire.
- After running a server for 10 minutes, confirm at least one quest emerged from NPC needs.

---

## Critical files to be modified or created

**Modified**
- `concord-frontend/lib/concordia/combat/hotbar.ts:84` — scope fix.
- `server/server.js` — DTU creation route validator wiring; governorTick scheduler integration.
- `server/lib/narrative-bridge.js` — enrich oracle context with social shadows + medical knowledge.
- `concord-frontend/components/world-lens/SoundscapeEngine.tsx` — initialize on world entry; wire to soundscape-bridge.
- `concord-frontend/components/world-lens/BuildingRenderer3D.tsx` — read `world_buildings` table for spawned blueprints.
- `concord-frontend/app/lenses/timeline/page.tsx` — privacy UI improvements + "NPCs are listening" indicator.
- `server/emergent/module-registry.js` — registry pattern.

**Created**
- `server/lib/dtu-validators/recipe-validators.js`
- `server/emergent/social-npc-bridge.js` (also handles federation pass + realtime fast-path).
- `server/lib/soundscape-bridge.js`
- `server/migrations/069-avatar-loadouts.js`
- `server/routes/avatars.js`
- `server/lib/npc-knowledge-bridge.js`
- `server/routes/world-buildings.js` (or extend existing world.js)
- `concord-frontend/components/concordia/recipes/RecipeAuthorPanel.tsx`
- `concord-frontend/app/lenses/crafting/page.tsx`

## Reused functions (cite to avoid duplication)

- `server/lib/sovereignty-invariants.js:13` — `assertSovereignty()` for personal-DTU access.
- `server/economy/creative-marketplace.js:99` — `publishArtifact()` for marketplace listing.
- `server/economy/royalty-cascade.js:150` — `distributeRoyalties()` for all sales.
- `server/lib/crafting/craft-engine.js:26` — `executeCraft()` for any new recipe DTU.
- `server/emergent/shadow-graph.js` — `wireShadowEdges_pattern()`, `recordInteractionFromNPC()`.
- `server/lib/skill-progression.js` — `awardExperience()` with `cross_world_use` event type.
- `server/routes/personal-locker.js:136` — existing publish-to-public-substrate.

## End-to-end verification (full vision)

1. Player A uploads a music DTU + a fighting-style recipe + a building blueprint + a medical-research DTU.
2. Player A enables `'public'` privacy on a Social Lens post about their work.
3. Player B walks into Player A's plaza district — hears Player A's music track. Walks past Player A's spawned building. Enters a hospital, hears NPC doctor reference Player A's medical technique.
4. NPCs in Player B's world reference Player A's social post in dialogue (verifiable via oracle-brain log inspection).
5. Player A lists fighting-style recipe on marketplace at remix=$15. Player C buys at remix tier, equips, uses. Player A receives 95% share. Player C publishes a derivative — royalties cascade back to A.
6. Run for 10 minutes; confirm at least one emergent NPC quest, one new combat combo derivation, and one new social-shadow have been recorded.

---

### Workstream 6 — Multi-avatar loadout, federation, realtime streaming, DAW→soundscape

These four pieces have meaningful substrate already; folding them in rather than deferring.

**6a. Per-avatar loadout (multi-avatar per user)**
- Schema migration `server/migrations/069-avatar-loadouts.js` (new) — adds `avatars(user_id, avatar_id, name, slug, created_at)` table; adds `avatar_id` column to `personal_dtus`, `player_inventory`, `combat_loadout` tables (nullable for backwards compat — existing rows treated as the user's primary avatar).
- `server/routes/avatars.js` (new) — `GET /api/avatars`, `POST /api/avatars`, `PUT /api/avatars/:id/activate` (selects active avatar for the session).
- `server/routes/personal-locker.js` — extend query to filter by `(user_id, avatar_id)` when avatar_id is in the session; existing one-avatar users are unaffected (their rows have null avatar_id and are returned for every avatar of theirs OR migrated to a "primary" avatar at first login).
- Frontend: avatar switcher in profile menu; per-avatar hotbar; per-avatar personal-locker view.
- The hotbar already accepts a `_playerId` parameter at `hotbar.ts:129` (currently unused) — wire it to the active avatar id.

**6b. Federation (cross-instance NPC awareness)**
- The `federation` lens we just added to the registry has `concord-frontend/app/lenses/federation/page.tsx` and a `TrustGraphView` component. Per CLAUDE.md the seven-layer mesh network exists.
- Extend `social-npc-bridge.js` from Workstream 2 with a federation pass: also pull public Shadow DTUs from peers in the trust graph (rate-limited by trust score), tag them `'federated_signal'`, and feed them to NPC oracle context with lower weight than local shadows.
- Frontend: trust-graph view annotates peers whose shadows are flowing in.

**6c. Realtime WebSocket post streaming**
- Existing realtime infrastructure: `REALTIME.io` (socket.io) already broadcasts world events. Hook the timeline DTU creation route to `realtimeEmit('timeline:post', { dtuId, privacy, worldId })`.
- `social-npc-bridge.js` adds a realtime listener path *in addition to* the every-5-tick batch — so a public post can reach a nearby NPC in under a second when a player explicitly wants the immediacy. The 5-tick batch is still the safety net for catch-up.
- Frontend: timeline lens subscribes to `timeline:post` events and inserts them live; "NPC reaction" widget surfaces dialogue snippets in near-real-time.

**6d. DAW → soundscape layering**
- The DAW engine (`concord-frontend/lib/daw/engine.ts`) has transport, mixer, synth, drum, recorder primitives. CLAUDE.md notes UI is built but unwired.
- Wire DAW UI to engine (the unwired path noted in CLAUDE.md for Workstream 4 anyway).
- `SoundscapeEngine.tsx` gains a "DAW layer" slot: a player's currently-playing DAW project plays as foreground music in their immediate vicinity (concentric falloff), layered over the district ambient stems. Lets the studio lens be a live performance space inside Concordia.
- Persist DAW projects as DTUs (`core.type='daw_project'`) so others can buy/perform them; remix-tier purchase opens the project in the buyer's DAW lens.

**Verification (Workstream 6)**
- Avatar: create a 2nd avatar → equip a different fighting style → switch back to avatar 1 → confirm hotbar reverts.
- Federation: bring up a 2nd instance, peer it via existing federation flow, post publicly on the peer → confirm NPCs in the local instance reference the peer's post tagged `'federated_signal'`.
- Realtime: open two browsers, post publicly in one, see it appear instantly in the other's timeline; check that an adjacent NPC reacts within a few seconds rather than waiting 5 minutes.
- DAW: load a DAW project → press play → walk around an outdoor district → confirm DAW audio fades with distance, district ambience stays present.
