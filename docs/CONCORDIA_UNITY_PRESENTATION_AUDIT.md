# Concordia Unity presentation audit

**Date:** 2026-09-12. **Premise (owner):** the MMO simulation already exists.
Unity currently presents only a fraction of the consequences. Do **not** invent
new engines. Find every Concordia backend system that has a real
event/state/output but no Unity manifestation, then present the ones already
on the wire.

Reproduction (re-run before trusting a count here):

```bash
# Unity HandleFrame event names
rg -o 'evt == "[^"]+"' apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ConcordClient.cs
# io.emit-only sites that still need gateway mirrors
rg -n 'io\?\.emit\?\.|io\.to\(`world:' server/emergent server/lib --glob '!**/tests/**'
# Village gossip is REST, not a socket
rg -n 'getVillageGossipFeed' server/lib/npc-relationships.js server/routes/worlds.js
```

Transport classes (how a kernel signal can reach `/unity-ws`):

| Class | Meaning |
|---|---|
| `realtimeEmit` | Already fans into Unity (`_unityGatewayEmitter`). Handler is the only gap. |
| `emitToWorld` | Already mirrors Unity. Handler is the only gap. |
| `io.emit` / `io.to` | Socket.io-only until `mirrorToGateways`. Unity is deaf without the mirror. |
| `REST` / `lens:run` | Unity has **no HTTP client**. Pull via `world:snapshot` or `lens:run`. |
| `silent` | Real DB/state, no player-facing emit. Presenting it requires a thin emit of **existing** fields — not a new engine. |

Triage: **PRESENT-NOW** (handler + maybe mirror, this pass) · **ALREADY-REAL** ·
**NEEDS-EMIT** (state is real, no event yet) · **LENS-RUN** · **3D-LATER**
(in-world acting, Mixamo, tombs as meshes) · **DEFER** (too chatty / no 3D
substrate yet).

---

## The 15 candidates (code, not memory)

| # | Claim | Kernel | Transport before this pass | Three.js | Unity before this pass | Triage |
|---|---|---|---|---|---|---|
| 1 | Faction civilization is alive (stance / momentum / next-move / pairwise relations / deterministic `pickMove`) | `lib/embodied/faction-strategy.js` `applyMove`; cycle at `emergent/faction-strategy-cycle.js`. Authored `rival_factions` / `allied_factions` seed rows (`seedFactionStrategyState`). | `faction:war-declared` / `alliance-formed` / `truce-sought` via `_concordRealtimeEmit` (**already Unity**). `faction:strategy-move` was `io.emit` only. | `EmergentEventFeed`, `StrategicWarBanner`, `AdaptiveScoreBridge`, spectate ticker | Authored factions exist in `WorldBook` as kit metadata. **No HandleFrame cases.** | PRESENT-NOW |
| 2 | NPC death ≫ disappear (last words, inheritance, CK3 hooks, death-appraisal, tombs) | `lib/npc-legacy.js` `onNpcDeath` / `getTombsForWorld` / `inheritHooks` | `npc:heir-rose` already `realtimeEmit` (T2.2). Last words lived only in `npc_legacies`. | dialogue tomb line; npc-legacy domain | HUD heir announce + `inheritance:data`. **No last words, no tomb list.** | PRESENT-NOW (last words + tomb rows on snapshot). 3D tomb meshes later. |
| 3 | Village gossip is a real feed | `getVillageGossipFeed` → `GET /api/worlds/:id/npc-relationships/gossip-feed` | REST only. Separate SL2 rumor engine (`lib/social/gossip.js`) is NPC→NPC spread, also not on `/unity-ws`. | `VillageGossipFeed.tsx` (WorldOsSurface dynamic import) | Nothing | PRESENT-NOW via `world:snapshot.gossip`. Empty stays `[]`. |
| 4 | Adaptive music is event-driven | `AdaptiveScoreBridge.tsx` + `lib/concordia/adaptive-score.ts` `scoreDirectivesFor` | Same sockets as #1/#9. Mapping is pure (war→minor 0.85, alliance/crisis-resolved→major, scheme outcome forks). | SoundscapeEngine | No soundscape SM | DEFER the audio SM. **Inherit this mapping; do not invent a second one.** First wave: the same events hit the consequence strip. |
| 5 | World bosses are a scheduled subsystem | `emergent/world-boss-cycle.js`, `lib/world-bosses.js`, content-seeder (cold-start empty table was the bug, now seeded) | `world:boss-spawn` was `io.emit` only. `boss:state` / `boss:phase-enter` still `io.to` in `routes/worlds.js` (combat HUD). | `NamedEncounterController`, `BossHealthBar`, EmergentEventFeed | Nothing | PRESENT-NOW for spawn. Phase/HP HUD is 3D-LATER (needs a live boss body). |
| 6 | NPC stress feeds behavior | `lib/npc-stress.js` — grudges/war/heir death/rituals → `coping_trait` (paranoid/reckless/cruel/withdraw/drink) → `pickMove` bias + narrative traits + routine overrides. Break at stress ≥ 80. | **Silent.** `bumpStress` logged; no socket. | coping line in dialogue only | Local `NpcLife` jobs; no kernel stress | PRESENT-NOW: emit `npc:stress-break` on the existing `broke` write. 3D acting (drunk walk, withdrawn idle) is later. |
| 7 | Social gatherings | Two different systems. (a) `lib/social-gatherings.js` composes wedding/funeral/festival attendees from live relations — **pull** via `daily_life.gather`. (b) `world:gathering-detected` is **player** co-location (`spontaneousGatherings`). (c) `world:npc-gather` is an NPC **harvesting a resource node**, not a funeral. | (a) REST/macro. (b) `emitToWorld` already Unity. (c) `io.to` only. | EventsGatherings; WorldOsSurface | `world:npc-gather` → log line `"a gathering"` (wrong event) | PRESENT-NOW: detected clusters + honest harvest line. Funerals: LENS-RUN / 3D-LATER (no push emit; do not fake crowds). |
| 8 | Combat stack is deeper than a damage formula | biomech / motor / reflex / impact / momentum / strike FX / mastery / boss phases / flow / executions / faction-war | T1.4a/b + F1.3 + F3.5 already on `/unity-ws` | CombatHUD, juice bridges | Typed telegraphs, impact momentum, knockback. Mixamo clips **not** done. | ALREADY-REAL for feel wire. Next leap is **legibility** (3D-LATER Mixamo), not another formula. |
| 9 | Gossip + emergent feed + music = one presentation layer | `EmergentEventFeed.tsx` (~20 channels: deaths, dreams, drift, faction wars, bosses, seasons, schemes…) | Mix of `realtimeEmit` and `io.emit` | WorldOsSurface loads feed + gossip + AdaptiveScoreBridge | Scattered `NoteAct` / `Announce` | PRESENT-NOW: one Unity consequence strip. |
| 10 | NPC migration | `emergent/population-migration-cycle.js` (T2.4 wired the orphan) | **Silent.** Arrivals write DB; no player-facing emit. | none | none | NEEDS-EMIT (then present). Do not invent a migration engine. |
| 11 | NPC economy | `emergent/npc-economy-cycle.js` → `npc:economy-batch` | `realtimeEmit` (already Unity) | EmergentEventFeed | `npc:level-up` → `"someone grew"` only | PRESENT-NOW when crafts/trades/notable are real and non-zero. |
| 12 | Seasons / festivals | `lib/seasons.js` `world:season-transition`; `emergent/festival-trigger-cycle.js` `festival:started` | Both `io` only | EmergentEventFeed, FestivalBanner | Clock/weather bound; no season/festival beat | PRESENT-NOW |
| 13 | Skill mastery | `skills.mastery` via `lens:run` | already | skill HUD | **K overlay + pylons** | ALREADY-REAL. Do not rebuild. |
| 14 | Combat replay / chronicle | match chronicles / combat-flow recording | REST / domain | some HUD | none | 3D-LATER |
| 15 | Crafted DTUs as world objects | DTU substrate | REST | marketplace lenses | none | 3D-LATER |

**Also found (not on the original 15, same class):**

| Signal | Kernel | Unity gap | Triage |
|---|---|---|---|
| `npc:activity-batch` | routine cycle, every ~75s | too chatty for a toast | DEFER (strip would drown) |
| `kingdom:decree-enacted` / `fallen` / `contested` | kingdom-decrees | no HandleFrame | next wave |
| `dream:composed` / `prediction:realised` | embodied cycles | no HandleFrame | next wave |
| `world:refusal-field` | refusal-field | no HandleFrame | next wave |

---

## Closed this pass (no new engines)

1. **Gateway mirrors** so io-only emits reach `/unity-ws`: `faction:strategy-move`,
   `world:boss-spawn`, `festival:started`, `world:season-transition`,
   `world:npc-gather`.
2. **Unity consequence strip** (`WorldClock.PushFeed` + HUD) — the Emergent
   Event Feed role, keyed off real payloads (`summary`, `seasonName`,
   `bossTemplate`, gossip `summary`). Missing substrate stays unrendered.
3. **HandleFrame** for faction war/alliance/truce/strategy-move, gathering
   detected, honest NPC harvest, boss spawn, season, festival, economy-batch
   (only when crafts/trades/notable exist), stress-break, heir last words.
4. **`world:snapshot`** now includes `gossip` + `tombs` from the existing
   readers. Empty arrays stay empty.
5. **`npc:stress-break`** — thin emit of the existing `broke` + `copingTrait`
   write. Faction coping bias was already live; Unity can now *see* the break.
6. **`npc:heir-rose.lastWords`** — the words `onNpcDeath` already composed.

**3D collision pass (same payloads, in-world):**

1. **Kernel tombs** from `world:snapshot.tombs` — stone + E last-words when
   xz fits the presenter or a matching `GuestNpc` exists. Nearby NPCs
   `Notice` the grave. Empty stays empty. Far kernel coords are skipped.
2. **Gossip overheard** — snapshot now includes `npcA`/`npcB`. Matching
   `GuestNpc`s get a `GossipEar`; walking within 7m one-shots the real
   `summary`. No fake speakers.
3. **Stress acting** — `npc:stress-break` finds a `GuestNpc` and
   `NpcLife.Cope(trait)`: drink→tavern Sit, withdraw skips social,
   reckless faster walk, paranoid NoticePlayer, cruel Notices a neighbor.
4. **Gathering marker** — `world:gathering-detected` centroid x/y/z as a
   temporary tell. Never a fabricated crowd.
5. **Faction banners** — `faction:war-declared` brightens existing
   `FactionBanner_{id}`. No match is a no-op.
6. **Adaptive music** — Unity `AdaptiveScore.For` is a literal port of
   `scoreDirectivesFor` (0.85/minor 12s war, 0.7/minor 15s crisis, major
   8s on alliance/crisis-resolved, scheme outcome fork). Drives the
   existing Ethereal/Suspenseful/Action sources.
7. **Migration** — `arriveAtDestination` emits `npc:migrated` with its
   existing fields. Matching GuestNpc `HeadFor` the named gate or spawn.

**Not this pass:** Mixamo, funeral 3D crowds, boss HP bar / boss body,
crafted-DTU world props, unique GLB per world, interiors, F2 affixes,
F5.1 raid lockout.

Honesty checks:

- `world:npc-gather` is a **resource swing**, not a social scene. The Unity
  line now names the resource. Do not relabel it as a funeral.
- Funerals/weddings are `daily_life.gather` composition. There is no
  heartbeat that spawns mourners in the 3D world. Empty stays empty.
- Gossip with zero `npc_nemesis_events` rows is `[]`, never invented rumor.
- Adaptive music: Unity `AdaptiveScore.For` copies `scoreDirectivesFor`.
  Do not fork a second mapping.
- World bosses still have **no spawn coordinates**. HUD only — do not drop
  a fake body at the arena.
