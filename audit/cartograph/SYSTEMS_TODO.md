# Systems TODO — Phase 3 + Phase 4 Action List

_Auto-derived from cartographer outputs (`SYSTEMS.json`, `GAPS.md`). Each row points at a wire target. Frontend Parity Invariant applies — every backend wire ships with full-polish frontend in the same commit._

Generated: post-Phase-1.

---

## Phase 3 — Wire-the-Lost (priority order)

These 8 modules already exist in the corpus with macros registered through Ghost Fleet (`server.js:initGhostFleet()`), but no heartbeat schedule and/or no UI lens. They get a heartbeat tick if periodic execution is warranted, plus a full-polish frontend lens that calls their macros.

| # | Module | Substrate | Lens fit | Wire shape | Heartbeat freq |
|---|---|---|---|---|---|
| 1 | `forgetting-engine` | `server/emergent/forgetting-engine.js` | `lenses/reasoning` (extension) — "Memory Health" tab | macros + heartbeat | 480 (~2h) |
| 2 | `attention-allocator` | `server/emergent/attention-allocator.js` | `lenses/attention` | macros via existing domain | 30 |
| 3 | `quest-engine` | `server/emergent/quest-engine.js` | `lenses/questmarket` (already exists, wire UI) | frontend → `/api/lens/run` | none (player-driven) |
| 4 | `culture-layer` | `server/emergent/culture-layer.js` | `lenses/culture` (NEW dir) — drift heatmap | tick-driven cultural drift | 120 (~30 min) |
| 5 | `dream-capture` | `server/emergent/dream-capture.js` | `lenses/atlas` extension | capture endpoint + atlas surface | none |
| 6 | `app-maker` | `server/emergent/app-maker.js` | `lenses/app-maker` (frontend exists, wire backend macros) | frontend → existing macros | none |
| 7 | `creative-generation` | `server/emergent/creative-generation.js` | `lenses/art`, `lenses/studio` | UI buttons → existing macros | none |
| 8 | `breakthrough-clusters` | `server/emergent/breakthrough-clusters.js` | `lenses/research` (NEW dir) | frontend surfaces metrics + trigger | already heartbeat-wired (lattice-orchestrator) |

### Headless backend domains worth surfacing alongside the 8 above

Top-15 macro domains with no matching frontend lens dir (from `GAPS.md`). These are full backends that never reached a UI:

| Domain | Macros | Suggested target lens |
|---|---:|---|
| `worldmodel` | 16 | `lenses/worldmodel` (NEW) — counterfactual/simulation surface |
| `culture` | 16 | `lenses/culture` (NEW) — covered above (#4) |
| `agents` | 13 | `lenses/agents` (already exists?) — confirm + wire |
| `entity_economy` | 13 | `lenses/entity-economy` (NEW) |
| `goals` | 12 | `lenses/goals` (NEW) |
| `metacognition` | 12 | `lenses/metacognition` (NEW) |
| `creative` | 12 | `lenses/creative` (already exists?) |
| `teaching` | 11 | `lenses/teaching` (NEW) |
| `autonomy` | 11 | `lenses/autonomy` (NEW) |
| `conflict` | 11 | `lenses/conflict` (NEW) |
| `cri` | 11 | `lenses/cri` (already exists per recon) |
| `shield` | 11 | `lenses/shield` (NEW) |
| `quest` | 10 | covered above (#3) |
| `mesh` | 10 | covered in Phase 4 (#14) |
| `hlm` | 9 | covered in Phase 4 (#10 system) |

These get folded into Phase 3 wires where they cluster with the 8 above; otherwise they're deferred to a Phase 3.5 "headless-backends sweep" if backlog allows.

### Dead tables (24)

Drives Phase 3.5 cleanup pass. For each: wire reader macro `analytics.<table>Stats` if data is meaningful, OR prepend the migration with `// REPLACED_BY: migration_<N>` comment. Never DROP — keep `CREATE TABLE IF NOT EXISTS` idempotent.

Top candidates for archival (no readers anywhere — likely abandoned migrations):
- `personality_state`, `personality_evolution_log`, `wants`, `want_audit_log`, `want_suppressions`, `spontaneous_queue`, `spontaneous_user_prefs`, `want_actions` (migration 009 — likely superseded by later DTU/persona work)
- `dtu_citations`, `dtu_helpfulness`, `retrieval_metrics`, `novelty_daily`, `dedup_audits`, `pruning_history`, `generation_quotas` (migration 010 — likely superseded)
- `creation_diffusion` (mig 044), `guilds`, `guild_members` (mig 052 — supplanted by orgs?)
- `messaging_verification_codes` (mig 056), `reasoning_sessions` (mig 059), `plugin_installs` (mig 085)
- `evo_asset_interactions_fix`, `evo_asset_versions_fix` (mig 107 — actually rebuild staging tables, can stay or `REPLACED_BY` themselves)

Audit each before archiving — some "dead" tables are read by frontend code or cron jobs that grep can't see.

---

## Phase 4 — Universe-gap fill (priority order)

| # | Category | Target lens | Status | Effort |
|---|---|---|---|---|
| 1 | `srs` (Anki/FSRS) | `lenses/srs` | partial | 1.5–2 days |
| 2 | `notebook` (Jupyter) | `lenses/notebook` | partial | 2 days |
| 3 | `spreadsheet` | `lenses/spreadsheet` (NEW) | missing | 2 days |
| 4 | `mind-map` / `outliner` | `lenses/whiteboard` ext | partial | <1 day |
| 5 | `diagram` (mermaid) | `lenses/whiteboard` renderer | missing | <1 day |
| 6 | `unified-self` | `lenses/self` (NEW) | partial | <1 day |
| 7 | `e-signature` | `lenses/legal` ext | missing | <1 day |
| 8 | `tts` / `asr` | `lenses/voice` ext | partial | 1 day |
| 9 | `web-research` | `lenses/web` (NEW) | partial | 1.5–2 days |
| 10 | `system` / kernel | `lenses/system` (NEW) | partial | 1.5 days |
| 11 | `compile` / build | `lenses/compile` (NEW) | missing | 1.5 days |
| 12 | `brain-training` | `lenses/lattice` (already exists?) | unknown | 1.5 days |
| 13 | `crypto` / chain | `lenses/crypto` (exists, wire) | partial | 2 days |
| 14 | `mesh` / network | `lenses/mesh` (NEW) | partial | 1.5 days |

**Constitutional invariant:** no ads, no subscriptions, no paywalls. Every lens free at the point of use; economy is creator-royalty cascade only.

---

## Frontend Parity Invariant (every Phase 3 + 4 commit)

Each wire commit MUST address all 9 polish requirements before merge:

1. All states (loading/empty/error/populated/optimistic/success/failure)
2. Realtime subscriptions where backend emits events
3. Every macro accessible via UI affordance
4. Animations / motion (Framer Motion or CSS)
5. Mobile-responsive
6. Accessibility (kbd nav, focus rings, ARIA, WCAG AA contrast)
7. Dark mode
8. Polish details (hover, tooltips, skeletons, toasts, undo)
9. Tier-3 E2E happy-path test

PR descriptions enumerate which requirements were addressed.

---

## Post-Phase-1 status

- **Phase 1**: ✅ shipped (commit `618400d`, PR #300)
- **Phase 2**: this audit + CLAUDE.md merge → next commit
- **Phase 3**: 8 wires upcoming
- **Phase 4**: 14 universe-gap fills upcoming
- **Phase 5**: CI guard + Tier-3 E2E + demo

Re-run cartographer after each commit to refresh `SYSTEMS.json` and verify orphan/dormant counts drop monotonically.
