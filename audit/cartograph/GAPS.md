# Gaps & Wire Targets

_Generated 2026-06-09T02:16:46.505Z. Each gap proposes a concrete wire action._

## Dead tables (28)

| Table | Migration | Wire option | Archive option |
|---|---|---|---|
| `dtu_embeddings` | server/migrations/006_embedding_column.js | `analytics.dtu_embeddingsStats` macro | // REPLACED_BY: migration_NN |
| `preserved` | server/migrations/009_brain_want_engine.js | `analytics.preservedStats` macro | // REPLACED_BY: migration_NN |
| `personality_state` | server/migrations/009_brain_want_engine.js | `analytics.personality_stateStats` macro | // REPLACED_BY: migration_NN |
| `personality_evolution_log` | server/migrations/009_brain_want_engine.js | `analytics.personality_evolution_logStats` macro | // REPLACED_BY: migration_NN |
| `want_suppressions` | server/migrations/009_brain_want_engine.js | `analytics.want_suppressionsStats` macro | // REPLACED_BY: migration_NN |
| `spontaneous_queue` | server/migrations/009_brain_want_engine.js | `analytics.spontaneous_queueStats` macro | // REPLACED_BY: migration_NN |
| `spontaneous_user_prefs` | server/migrations/009_brain_want_engine.js | `analytics.spontaneous_user_prefsStats` macro | // REPLACED_BY: migration_NN |
| `want_actions` | server/migrations/009_brain_want_engine.js | `analytics.want_actionsStats` macro | // REPLACED_BY: migration_NN |
| `dtu_helpfulness` | server/migrations/010_learning_verification.js | `analytics.dtu_helpfulnessStats` macro | // REPLACED_BY: migration_NN |
| `retrieval_metrics` | server/migrations/010_learning_verification.js | `analytics.retrieval_metricsStats` macro | // REPLACED_BY: migration_NN |
| `novelty_daily` | server/migrations/010_learning_verification.js | `analytics.novelty_dailyStats` macro | // REPLACED_BY: migration_NN |
| `dedup_audits` | server/migrations/010_learning_verification.js | `analytics.dedup_auditsStats` macro | // REPLACED_BY: migration_NN |
| `pruning_history` | server/migrations/010_learning_verification.js | `analytics.pruning_historyStats` macro | // REPLACED_BY: migration_NN |
| `generation_quotas` | server/migrations/010_learning_verification.js | `analytics.generation_quotasStats` macro | // REPLACED_BY: migration_NN |
| `creation_diffusion` | server/migrations/044_substrate_diffusion.js | `analytics.creation_diffusionStats` macro | // REPLACED_BY: migration_NN |
| `guilds` | server/migrations/052_guild_persistence.js | `analytics.guildsStats` macro | // REPLACED_BY: migration_NN |
| `guild_members` | server/migrations/052_guild_persistence.js | `analytics.guild_membersStats` macro | // REPLACED_BY: migration_NN |
| `messaging_verification_codes` | server/migrations/056_messaging_adapters.js | `analytics.messaging_verification_codesStats` macro | // REPLACED_BY: migration_NN |
| `reasoning_sessions` | server/migrations/059_reasoning_sessions.js | `analytics.reasoning_sessionsStats` macro | // REPLACED_BY: migration_NN |
| `plugin_installs` | server/migrations/085_plugin_gallery.js | `analytics.plugin_installsStats` macro | // REPLACED_BY: migration_NN |
| `evo_asset_interactions_fix` | server/migrations/107_evo_assets_fk_repair.js | `analytics.evo_asset_interactions_fixStats` macro | // REPLACED_BY: migration_NN |
| `evo_asset_versions_fix` | server/migrations/107_evo_assets_fk_repair.js | `analytics.evo_asset_versions_fixStats` macro | // REPLACED_BY: migration_NN |
| `mount_riders` | server/migrations/224_immersive_substrate.js | `analytics.mount_ridersStats` macro | // REPLACED_BY: migration_NN |
| `letter_delivery_queue` | server/migrations/224_immersive_substrate.js | `analytics.letter_delivery_queueStats` macro | // REPLACED_BY: migration_NN |
| `turn_combats` | server/migrations/251_turn_combat.js | `analytics.turn_combatsStats` macro | // REPLACED_BY: migration_NN |
| `turn_combatants` | server/migrations/251_turn_combat.js | `analytics.turn_combatantsStats` macro | // REPLACED_BY: migration_NN |
| `turn_log` | server/migrations/251_turn_combat.js | `analytics.turn_logStats` macro | // REPLACED_BY: migration_NN |
| `omitted` | server/migrations/275_evo_asset_fk_repair.js | `analytics.omittedStats` macro | // REPLACED_BY: migration_NN |

## Orphan modules (0)

_None._

## Dormant ghost-fleet / emergent modules (0)

_None — every module either has a heartbeat or is invoked by a macro callsite._

## Headless backend domains (26)

| Domain | Macro count | Suggested frontend lens dir |
|---|---:|---|
| `semantic` | 8 | `concord-frontend/app/lenses/semantic/page.tsx` |
| `compile` | 1 | `concord-frontend/app/lenses/compile/page.tsx` |
| `observability` | 1 | `concord-frontend/app/lenses/observability/page.tsx` |
| `refusal` | 4 | `concord-frontend/app/lenses/refusal/page.tsx` |
| `forward_sim` | 3 | `concord-frontend/app/lenses/forward-sim/page.tsx` |
| `embodied` | 3 | `concord-frontend/app/lenses/embodied/page.tsx` |
| `scars` | 2 | `concord-frontend/app/lenses/scars/page.tsx` |
| `mount` | 2 | `concord-frontend/app/lenses/mount/page.tsx` |
| `fidelity` | 2 | `concord-frontend/app/lenses/fidelity/page.tsx` |
| `walker` | 4 | `concord-frontend/app/lenses/walker/page.tsx` |
| `kingdom` | 1 | `concord-frontend/app/lenses/kingdom/page.tsx` |
| `reflex` | 4 | `concord-frontend/app/lenses/reflex/page.tsx` |
| `macro_dag` | 3 | `concord-frontend/app/lenses/macro-dag/page.tsx` |
| `narrative` | 1 | `concord-frontend/app/lenses/narrative/page.tsx` |
| `deity` | 5 | `concord-frontend/app/lenses/deity/page.tsx` |
| `npc_autobiography` | 2 | `concord-frontend/app/lenses/npc-autobiography/page.tsx` |
| `npc_persona` | 3 | `concord-frontend/app/lenses/npc-persona/page.tsx` |
| `compression_art` | 2 | `concord-frontend/app/lenses/compression-art/page.tsx` |
| `spectator` | 3 | `concord-frontend/app/lenses/spectator/page.tsx` |
| `betting` | 5 | `concord-frontend/app/lenses/betting/page.tsx` |
| `observer` | 1 | `concord-frontend/app/lenses/observer/page.tsx` |
| `sonic_glyph` | 1 | `concord-frontend/app/lenses/sonic-glyph/page.tsx` |
| `bounty` | 3 | `concord-frontend/app/lenses/bounty/page.tsx` |
| `dtu_sync` | 3 | `concord-frontend/app/lenses/dtu-sync/page.tsx` |
| `sub_world` | 2 | `concord-frontend/app/lenses/sub-world/page.tsx` |
| `therapy` | 3 | `concord-frontend/app/lenses/therapy/page.tsx` |

## Orphan lenses (2)

| Lens dir | Reason | Action |
|---|---|---|
| `move-builder` | no_backend_evidence_in_page_tsx | wire backend OR remove |
| `narrative-walk` | no_backend_evidence_in_page_tsx | wire backend OR remove |

## Unused macros (0)

> Heuristic — chat router invokes macros dynamically by name, so over-reports are expected. Cross-referenced against `publicReadDomains` allowlist.

_None._

## Unshaped socket events (34)

| Event | First emitter | Action |
|---|---|---|
| `world:basketball-started` | server/domains/basketball.js:19 | add to event-shapes.js |
| `liveshare:op` | server/domains/code.js:2340 | add to event-shapes.js |
| `ghost-hunt:residue-confronted` | server/domains/ghost-hunt.js:369 | add to event-shapes.js |
| `world:racing-started` | server/domains/racing.js:17 | add to event-shapes.js |
| `voice:participant-joined` | server/domains/voice-chat.js:45 | add to event-shapes.js |
| `voice:participant-left` | server/domains/voice-chat.js:62 | add to event-shapes.js |
| `voice:ice` | server/domains/voice-chat.js:104 | add to event-shapes.js |
| `voice:leave` | server/domains/voice-chat.js:117 | add to event-shapes.js |
| `quest:ecology-born` | server/emergent/ecology-quest-cycle.js:66 | add to event-shapes.js |
| `mount:behavior` | server/emergent/mount-behavior-cycle.js:164 | add to event-shapes.js |
| `mount:hungry` | server/emergent/mount-care-cycle.js:77 | add to event-shapes.js |
| `mount:loyalty-low` | server/emergent/mount-care-cycle.js:80 | add to event-shapes.js |
| `npc:travelled` | server/emergent/npc-travel-cycle.js:48 | add to event-shapes.js |
| `npc:combat-resolved` | server/emergent/npc-vs-npc-combat-cycle.js:76 | add to event-shapes.js |
| `liveshare:debug:state-snapshot` | server/lib/code-liveshare-bus.js:111 | add to event-shapes.js |
| `subscribe.error` | server/lib/dx/dx-socket-bus.js:141 | add to event-shapes.js |
| `subscribe.ok` | server/lib/dx/dx-socket-bus.js:148 | add to event-shapes.js |
| `world:sonic-pulse` | server/lib/embodied/signals.js:106 | add to event-shapes.js |
| `house:visitor-arrived` | server/lib/house-visit.js:49 | add to event-shapes.js |
| `npc:quest-accepted` | server/lib/npc-quest-runner.js:36 | add to event-shapes.js |
| `npc:quest-completed` | server/lib/npc-quest-runner.js:56 | add to event-shapes.js |
| `mentorship:npc-adopted` | server/lib/npc-skill-author.js:252 | add to event-shapes.js |
| `npc:level-up` | server/lib/npc-skill-progression.js:52 | add to event-shapes.js |
| `webrtc:peer-left` | server/lib/webrtc-signalling.js:74 | add to event-shapes.js |
| `webrtc:peer-list` | server/lib/webrtc-signalling.js:49 | add to event-shapes.js |
| `yjs:doc-reset` | server/lib/yjs-realtime.js:169 | add to event-shapes.js |
| `yjs:sync-state` | server/lib/yjs-realtime.js:101 | add to event-shapes.js |
| `concordia:lethal-hit` | server/routes/worlds.js:2748 | add to event-shapes.js |
| `combat:hero_kill` | server/routes/worlds.js:2754 | add to event-shapes.js |
| `combat:bloodline_fire_cast` | server/routes/worlds.js:2756 | add to event-shapes.js |
| `world:npc-spared` | server/routes/worlds.js:955 | add to event-shapes.js |
| `boss:state` | server/routes/worlds.js:2639 | add to event-shapes.js |
| `combat:npc-attack-evaded` | server/routes/worlds.js:3095 | add to event-shapes.js |
| `brawl-invited` | server/server.js:51328 | add to event-shapes.js |

## Universe-coverage gaps (in-scope categories)

| # | Category | Status | Target lens |
|---:|---|---|---|
| **4** | `mind-map` | ❌ missing | lenses/whiteboard |
| **5** | `diagram` | ❌ missing | lenses/whiteboard |
| **6** | `unified-self` | ❌ missing | lenses/self |
| **12** | `brain-training` | ❌ missing | lenses/lattice |
| - | `body-comp` | 🟡 partial | lenses/self |
| - | `mathematics` | 🟡 partial | lenses/math |
| - | `slides` | 🟡 partial | lenses/slides |
| - | `wiki` | ❌ missing | lenses/docs |
| - | `screen-share` | ❌ missing | lenses/voice |
| - | `meditation` | 🟡 partial | lenses/mental-health |
| - | `healthcare` | ❌ missing | lenses/healthcare |
| - | `bibliography` | ❌ missing | lenses/paper |
| - | `dataset` | ❌ missing | lenses/database |
| - | `defense` | 🟡 partial | lenses/defense |
| - | `forestry` | 🟡 partial | lenses/agriculture |
| - | `veterinary` | 🟡 partial | lenses/bio |
| - | `urban-planning` | 🟡 partial | lenses/construction |
| - | `astronomy` | 🟡 partial | lenses/astronomy |
| - | `quantum` | 🟡 partial | lenses/quantum |
