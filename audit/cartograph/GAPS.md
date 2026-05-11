# Gaps & Wire Targets

_Generated 2026-05-11T04:20:06.947Z. Each gap proposes a concrete wire action._

## Dead tables (22)

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

## Orphan modules (0)

_None._

## Dormant ghost-fleet / emergent modules (0)

_None — every module either has a heartbeat or is invoked by a macro callsite._

## Headless backend domains (24)

| Domain | Macro count | Suggested frontend lens dir |
|---|---:|---|
| `refusal` | 4 | `concord-frontend/app/lenses/refusal/page.tsx` |
| `npc` | 3 | `concord-frontend/app/lenses/npc/page.tsx` |
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
| `root` | no_backend_evidence_in_page_tsx | wire backend OR remove |
| `ux-suite` | no_backend_evidence_in_page_tsx | wire backend OR remove |

## Unused macros (0)

> Heuristic — chat router invokes macros dynamically by name, so over-reports are expected. Cross-referenced against `publicReadDomains` allowlist.

_None._

## Unshaped socket events (5)

| Event | First emitter | Action |
|---|---|---|
| `mount:hungry` | server/emergent/mount-care-cycle.js:77 | add to event-shapes.js |
| `mount:loyalty-low` | server/emergent/mount-care-cycle.js:80 | add to event-shapes.js |
| `subscribe.error` | server/lib/dx/dx-socket-bus.js:141 | add to event-shapes.js |
| `subscribe.ok` | server/lib/dx/dx-socket-bus.js:148 | add to event-shapes.js |
| `world:sonic-pulse` | server/lib/embodied/signals.js:105 | add to event-shapes.js |

## Universe-coverage gaps (in-scope categories)

| # | Category | Status | Target lens |
|---:|---|---|---|
| **4** | `mind-map` | ❌ missing | lenses/whiteboard |
| **5** | `diagram` | ❌ missing | lenses/whiteboard |
| **6** | `unified-self` | ❌ missing | lenses/self |
| **12** | `brain-training` | ❌ missing | lenses/lattice |
| - | `mathematics` | 🟡 partial | lenses/math |
| - | `slides` | 🟡 partial | lenses/slides |
| - | `wiki` | ❌ missing | lenses/docs |
| - | `screen-share` | ❌ missing | lenses/voice |
| - | `meditation` | ❌ missing | lenses/mental-health |
| - | `healthcare` | ❌ missing | lenses/healthcare |
| - | `accounting` | 🟡 partial | lenses/accounting |
| - | `body-comp` | ❌ missing | lenses/self |
| - | `bibliography` | ❌ missing | lenses/paper |
| - | `dataset` | ❌ missing | lenses/database |
| - | `defense` | 🟡 partial | lenses/defense |
| - | `forestry` | 🟡 partial | lenses/agriculture |
| - | `veterinary` | 🟡 partial | lenses/bio |
| - | `urban-planning` | 🟡 partial | lenses/construction |
| - | `astronomy` | 🟡 partial | lenses/astronomy |
| - | `quantum` | 🟡 partial | lenses/quantum |
