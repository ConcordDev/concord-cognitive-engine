# Gaps & Wire Targets

_Generated 2026-05-08T06:41:49.685Z. Each gap proposes a concrete wire action._

## Dead tables (25)

| Table | Migration | Wire option | Archive option |
|---|---|---|---|
| `dtu_embeddings` | server/migrations/006_embedding_column.js | `analytics.dtu_embeddingsStats` macro | // REPLACED_BY: migration_NN |
| `preserved` | server/migrations/009_brain_want_engine.js | `analytics.preservedStats` macro | // REPLACED_BY: migration_NN |
| `personality_state` | server/migrations/009_brain_want_engine.js | `analytics.personality_stateStats` macro | // REPLACED_BY: migration_NN |
| `personality_evolution_log` | server/migrations/009_brain_want_engine.js | `analytics.personality_evolution_logStats` macro | // REPLACED_BY: migration_NN |
| `wants` | server/migrations/009_brain_want_engine.js | `analytics.wantsStats` macro | // REPLACED_BY: migration_NN |
| `want_audit_log` | server/migrations/009_brain_want_engine.js | `analytics.want_audit_logStats` macro | // REPLACED_BY: migration_NN |
| `want_suppressions` | server/migrations/009_brain_want_engine.js | `analytics.want_suppressionsStats` macro | // REPLACED_BY: migration_NN |
| `spontaneous_queue` | server/migrations/009_brain_want_engine.js | `analytics.spontaneous_queueStats` macro | // REPLACED_BY: migration_NN |
| `spontaneous_user_prefs` | server/migrations/009_brain_want_engine.js | `analytics.spontaneous_user_prefsStats` macro | // REPLACED_BY: migration_NN |
| `want_actions` | server/migrations/009_brain_want_engine.js | `analytics.want_actionsStats` macro | // REPLACED_BY: migration_NN |
| `dtu_citations` | server/migrations/010_learning_verification.js | `analytics.dtu_citationsStats` macro | // REPLACED_BY: migration_NN |
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

## Headless backend domains (77)

| Domain | Macro count | Suggested frontend lens dir |
|---|---:|---|
| `chicken3` | 4 | `concord-frontend/app/lenses/chicken3/page.tsx` |
| `multimodal` | 2 | `concord-frontend/app/lenses/multimodal/page.tsx` |
| `semantic` | 7 | `concord-frontend/app/lenses/semantic/page.tsx` |
| `explanation` | 4 | `concord-frontend/app/lenses/explanation/page.tsx` |
| `hlr` | 5 | `concord-frontend/app/lenses/hlr/page.tsx` |
| `hlm` | 9 | `concord-frontend/app/lenses/hlm/page.tsx` |
| `quest` | 10 | `concord-frontend/app/lenses/quest/page.tsx` |
| `teaching` | 11 | `concord-frontend/app/lenses/teaching/page.tsx` |
| `entity_economy` | 13 | `concord-frontend/app/lenses/entity-economy/page.tsx` |
| `autonomy` | 11 | `concord-frontend/app/lenses/autonomy/page.tsx` |
| `conflict` | 11 | `concord-frontend/app/lenses/conflict/page.tsx` |
| `culture` | 16 | `concord-frontend/app/lenses/culture/page.tsx` |
| `breakthrough` | 7 | `concord-frontend/app/lenses/breakthrough/page.tsx` |
| `physical` | 8 | `concord-frontend/app/lenses/physical/page.tsx` |
| `forgetting` | 7 | `concord-frontend/app/lenses/forgetting/page.tsx` |
| `attention_alloc` | 6 | `concord-frontend/app/lenses/attention-alloc/page.tsx` |
| `repair_network` | 4 | `concord-frontend/app/lenses/repair-network/page.tsx` |
| `apps` | 9 | `concord-frontend/app/lenses/apps/page.tsx` |
| `promotion` | 6 | `concord-frontend/app/lenses/promotion/page.tsx` |
| `explore` | 3 | `concord-frontend/app/lenses/explore/page.tsx` |
| `dream` | 5 | `concord-frontend/app/lenses/dream/page.tsx` |
| `dtu` | 10 | `concord-frontend/app/lenses/dtu/page.tsx` |
| `shield` | 11 | `concord-frontend/app/lenses/shield/page.tsx` |
| `foundation` | 1 | `concord-frontend/app/lenses/foundation/page.tsx` |
| `intel` | 8 | `concord-frontend/app/lenses/intel/page.tsx` |
| `cortex` | 6 | `concord-frontend/app/lenses/cortex/page.tsx` |
| `style` | 2 | `concord-frontend/app/lenses/style/page.tsx` |
| `ask` | 1 | `concord-frontend/app/lenses/ask/page.tsx` |
| `swarm` | 1 | `concord-frontend/app/lenses/swarm/page.tsx` |
| `wrapper` | 3 | `concord-frontend/app/lenses/wrapper/page.tsx` |
| `layer` | 3 | `concord-frontend/app/lenses/layer/page.tsx` |
| `persona` | 9 | `concord-frontend/app/lenses/persona/page.tsx` |
| `quality` | 2 | `concord-frontend/app/lenses/quality/page.tsx` |
| `spreadsheet` | 1 | `concord-frontend/app/lenses/spreadsheet/page.tsx` |
| `slides` | 1 | `concord-frontend/app/lenses/slides/page.tsx` |
| `compile` | 1 | `concord-frontend/app/lenses/compile/page.tsx` |
| `experiment` | 1 | `concord-frontend/app/lenses/experiment/page.tsx` |
| `context` | 1 | `concord-frontend/app/lenses/context/page.tsx` |
| `interface` | 1 | `concord-frontend/app/lenses/interface/page.tsx` |
| `log` | 1 | `concord-frontend/app/lenses/log/page.tsx` |
| `synth` | 1 | `concord-frontend/app/lenses/synth/page.tsx` |
| `evolution` | 1 | `concord-frontend/app/lenses/evolution/page.tsx` |
| `heartbeat` | 1 | `concord-frontend/app/lenses/heartbeat/page.tsx` |
| `auth` | 1 | `concord-frontend/app/lenses/auth/page.tsx` |
| `org` | 1 | `concord-frontend/app/lenses/org/page.tsx` |
| `jobs` | 3 | `concord-frontend/app/lenses/jobs/page.tsx` |
| `agent` | 4 | `concord-frontend/app/lenses/agent/page.tsx` |
| `crawl` | 2 | `concord-frontend/app/lenses/crawl/page.tsx` |
| `source` | 2 | `concord-frontend/app/lenses/source/page.tsx` |
| `verify` | 1 | `concord-frontend/app/lenses/verify/page.tsx` |

## Orphan lenses (153)

| Lens dir | Reason | Action |
|---|---|---|
| `[parent]` | page_tsx_empty_or_missing | wire backend OR remove |
| `affect` | no_matching_backend_domain | wire backend OR remove |
| `agriculture` | no_matching_backend_domain | wire backend OR remove |
| `all` | no_matching_backend_domain | wire backend OR remove |
| `alliance` | no_matching_backend_domain | wire backend OR remove |
| `analytics` | no_matching_backend_domain | wire backend OR remove |
| `animation` | no_matching_backend_domain | wire backend OR remove |
| `answers` | no_matching_backend_domain | wire backend OR remove |
| `app-maker` | no_matching_backend_domain | wire backend OR remove |
| `ar` | no_matching_backend_domain | wire backend OR remove |
| `art` | no_matching_backend_domain | wire backend OR remove |
| `artistry` | no_matching_backend_domain | wire backend OR remove |
| `astronomy` | no_matching_backend_domain | wire backend OR remove |
| `automotive` | no_matching_backend_domain | wire backend OR remove |
| `aviation` | no_matching_backend_domain | wire backend OR remove |
| `billing` | no_matching_backend_domain | wire backend OR remove |
| `bio` | no_matching_backend_domain | wire backend OR remove |
| `black-market` | no_matching_backend_domain | wire backend OR remove |
| `board` | no_matching_backend_domain | wire backend OR remove |
| `bridge` | no_matching_backend_domain | wire backend OR remove |
| `calendar` | no_matching_backend_domain | wire backend OR remove |
| `carpentry` | no_matching_backend_domain | wire backend OR remove |
| `chem` | no_matching_backend_domain | wire backend OR remove |
| `code` | no_matching_backend_domain | wire backend OR remove |
| `cognition` | no_matching_backend_domain | wire backend OR remove |
| `command-center` | no_matching_backend_domain | wire backend OR remove |
| `construction` | no_matching_backend_domain | wire backend OR remove |
| `consulting` | no_matching_backend_domain | wire backend OR remove |
| `cooking` | no_matching_backend_domain | wire backend OR remove |
| `crafting` | no_matching_backend_domain | wire backend OR remove |
| `creative-writing` | no_matching_backend_domain | wire backend OR remove |
| `creator` | no_matching_backend_domain | wire backend OR remove |
| `crypto` | no_matching_backend_domain | wire backend OR remove |
| `custom` | no_matching_backend_domain | wire backend OR remove |
| `daily` | no_matching_backend_domain | wire backend OR remove |
| `database` | no_matching_backend_domain | wire backend OR remove |
| `debate` | no_matching_backend_domain | wire backend OR remove |
| `debug` | no_matching_backend_domain | wire backend OR remove |
| `defense` | no_matching_backend_domain | wire backend OR remove |
| `desert` | no_matching_backend_domain | wire backend OR remove |
| `disputes` | no_matching_backend_domain | wire backend OR remove |
| `diy` | no_matching_backend_domain | wire backend OR remove |
| `docs` | no_matching_backend_domain | wire backend OR remove |
| `dtus` | no_matching_backend_domain | wire backend OR remove |
| `eco` | no_matching_backend_domain | wire backend OR remove |
| `education` | no_matching_backend_domain | wire backend OR remove |
| `electrical` | no_matching_backend_domain | wire backend OR remove |
| `emergency-services` | no_matching_backend_domain | wire backend OR remove |
| `energy` | no_matching_backend_domain | wire backend OR remove |
| `engineering` | no_matching_backend_domain | wire backend OR remove |
| ... | _+103 more_ | |

## Unused macros (0)

> Heuristic — chat router invokes macros dynamically by name, so over-reports are expected. Cross-referenced against `publicReadDomains` allowlist.

_None._

## Unshaped socket events (0)

_None — every emit is registered in `event-shapes.js`._

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
