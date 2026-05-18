# Smoking-Gun Backlog

**Generated**: 2026-05-18
**Method**: 5 parallel Explore agents + direct grep verification of top claims
**Coverage**: all 236 lenses + cross-cutting STATE Maps + cross-cutting asymmetric tables
**Status**: research punch list — fix opportunistically during research-parity rebuilds, OR knock out as quick wins between sprints

## Verification Status Legend
- ✅ **VERIFIED** — I re-grepped the claim and it stands
- ⚠️  **NEEDS VERIFICATION** — flagged by agent, not yet re-grepped; could be false positive
- ❌ **AGENT WAS WRONG** — re-grep showed the claim doesn't hold; documented to prevent re-discovery

## Severity Legend
- 🔴 **CRITICAL** — load-bearing bug, fix this sprint (data loss / production 404 / billing broken)
- 🟡 **IMPORTANT** — UX gap, fix during the lens's parity rebuild (or as quick win)
- 🟢 **NICE-TO-HAVE** — defer (polish / diagnostics / dead-code cleanup)

---

## 🔴 CRITICAL — fix immediately

### C1. Education lens has 20 endpoints returning 404 ✅
**File**: `concord-frontend/app/lenses/education/page.tsx`
**Symptom**: Page calls 20 `/api/learning/*` endpoints; server registers only 9. Every other learning action silently 404s.
**Verified 404 list**:
```
/api/learning/assessment/generate    /api/learning/leaderboard
/api/learning/assessment/grade        /api/learning/path
/api/learning/cohort/form             /api/learning/rates
/api/learning/cohort/match            /api/learning/submissions/mine
/api/learning/cohort/mine             /api/learning/submit
/api/learning/cohort/teach            /api/learning/tutor/ask
/api/learning/credential/me/          /api/learning/tutor/socratic
/api/learning/dtus/search             /api/learning/earnings/me
/api/learning/frontier                /api/learning/genome
/api/learning/genome/graph            /api/learning/interaction
```
**Fix size**: LARGE (full education lens rebuild — slot it into the next-lens-rebuild rotation as item #1)
**Fix sketch**: Build out the education domain — server/domains/education.js with all 20 macros, OR add a `/api/learning/*` route file. Tutor / Socratic / Assessment paths likely warrant the AI sprint pattern.

### C2. STATE.gameProfiles lost on restart ✅
**File**: `server/server.js:49505` and ~10 sites
**Symptom**: All player XP, levels, badges, streaks, quest completions stored in `STATE.gameProfiles = new Map()`. Players reset to level 1 with 0 XP every server restart.
**Fix size**: MEDIUM (migration + persistence helper + swap 10 sites — same playbook as council/marketplace cleanup)
**Fix sketch**: Migration `231_game_profiles.js` with (user_id PK, xp, level, badges_json, streak, last_activity_at, quests_completed, concord_coin). Persistence helpers in lib/game-profiles.js. Swap getGameProfile() to DB-first hydrate.

### C3. STATE.customPersonas lost on restart ✅
**File**: `server/server.js:34194` and ~7 sites
**Symptom**: User-created LLM personas (system prompts, style configs) stored in-memory only. Users must rebuild personas after every restart.
**Fix size**: MEDIUM
**Fix sketch**: Migration with (id PK, owner_id, name, description, style_json, traits_json, system_prompt, created_at, updated_at, usage_count). Note: chat-extras already has `chat_personas` table from migration 223 — verify whether STATE.customPersonas should consolidate into that table or stay separate.

### C4. STATE.councilProposals lost on restart (governance integrity) ✅
**File**: `server/server.js:42114` and 4 sites
**Symptom**: Active DTU promotion votes mid-flight die on restart. Governance deadlock.
**Fix size**: MEDIUM (migration + heartbeat expiry sweep)
**Fix sketch**: Migration with (id PK, dtu_id, proposed_by, reason, status, votes_json, created_at, expires_at). Add expiry sweep heartbeat. The 7-day window from line 42140 is the safety valve.

### C5. healthcare action name mismatch — `generate` vs `generateSummary` ✅
**File**: `concord-frontend/app/lenses/healthcare/page.tsx:1040` calls `action: 'generate'`; `server/domains/healthcare.js:257` registers `generateSummary`
**Symptom**: Frontend calls return MACRO_NOT_FOUND. The healthcare AI summarization feature is unreachable.
**Fix size**: SMALL (1-line rename either side — likely backend, since `generate` is the more idiomatic call)
**Fix sketch**: Rename `generateSummary` → `generate` in the macro registration. Verify no other callers use the old name.

### C6. world lens calls `domain: 'mainland'` — domain doesn't exist ⚠️
**File**: `concord-frontend/app/lenses/world/page.tsx:4803` (agent claim, needs verification)
**Symptom**: Frontend macro call to a domain with zero handlers.
**Fix size**: SMALL — depending on what mainland *should* do
**Fix sketch**: Either rename to `world` or `city` (whichever the call body matches), OR create server/domains/mainland.js as a thin wrapper.

### ❌ C7. 5 lens domains store user data in STATE Maps — FALSE ALARM (verified)
**Re-verification result**: All 5 lens domains (accounting/healthcare/legal/food/education) ALREADY have `saveStateIfAvailable()` helpers that call `globalThis._concordSaveStateDebounced`. The persistence chain is: domain mutation → saveStateIfAvailable → globalThis save → debounced state_snapshots write → on restart, _hydrateState calls hydrateLensState which restores all LENS_STATE_KEYS (26 lenses covered including all 5). Saves per domain: accounting:2, healthcare:8, legal:2, food:7, education:7.

The agent missed the `globalThis._concordSaveStateDebounced` wire-up (set lazily at server.js:1894) and the `serializeLensState` / `hydrateLensState` wire-up at server.js:8638 + 8802.

**As a defense-in-depth measure**, the cleanup commit added a 60s `lens-state-snapshot-safety-net` heartbeat that triggers a snapshot regardless of mutation paths — so even if a lens domain forgets the saveStateIfAvailable call, there's a hard 60s upper-bound on data loss. But the urgent problem doesn't exist.

### (Legacy text) 5 lens domains store user data in STATE Maps
| Lens | File | Map name | Sites |
|---|---|---|---|
| accounting | `server/domains/accounting.js:22` | `STATE.accountingLens` | multiple |
| healthcare | `server/domains/healthcare.js:51` | `STATE.healthLens` (4 nested) | multiple |
| legal | `server/domains/legal.js:14` | `STATE.legalLens.cases` | multiple |
| education | `server/domains/education.js:13` | `STATE.educationLens` | multiple |
| food | `server/domains/food.js:58` | `STATE.foodLens` (pantry/recipes/meal-plans) | multiple |

**Symptom**: Account ledgers, medical records, legal cases, education credentials, pantry/recipes — ALL die on restart.
**Fix size**: LARGE per lens (1-day each) — but follows the same playbook as council/marketplace cleanup
**Fix sketch**: Each lens needs its own migration + persistence helpers + swap of in-memory Map calls to DB. Likely slot these into the lens's parity rebuild sprint.

---

## 🟡 IMPORTANT — knock out as quick wins or during parity rebuilds

### I1. macro_call_log billing is write-disabled in prod ⚠️
**Verified**: `FF_MACRO_BILLING` defaults to `1` in dev / `0` in prod (per `server/lib/feature-flags.js` convention comment). So macro_call_log is intentionally write-disabled in production.
**Decision needed**: enable billing in prod, OR remove the read-side dashboard surface that queries it.
**Fix size**: SMALL (config change) — but is policy, not a bug

### I2. STATE.feeds lost on restart ✅
**File**: `server/server.js:9180`
**Symptom**: Feed subscriptions die. Users re-add feeds after each restart.
**Fix size**: SMALL — simple key-value table
**Fix sketch**: Migration with (id PK, active, last_fetched_at, item_count, created_by, created_at). Seed defaults at startup.

### I3. STATE.entities lost on restart (Concord Link agents) ⚠️
**File**: `server/server.js:42879, 42913, 42919` (22 read sites)
**Symptom**: AI agent definitions vanish. The `runEntityNameMigration` function migrates names but the underlying entities live in memory only.
**Fix size**: LARGE (entity shape unclear, needs upstream investigation)

### I4. STATE.consent lost on restart ⚠️
**File**: `server/server.js:51136, 51138`
**Symptom**: Citation consent decisions wiped. Users re-consent on next visit.
**Fix size**: SMALL — likely already has a `creator_consent` table somewhere

### I5. STATE.cognitiveDigitalTwins lost on restart ⚠️
**File**: `server/server.js:56296, 56334, 56416, 56427, 56453, 56468, 56542` (7 sites)
**Symptom**: Per-user brain reasoning context lost. Twin "learns" the user, then forgets on restart.
**Fix size**: MEDIUM (depends on twin schema)

### I6. world lens — `city.*` macros inline in server.js ✅
**File**: `server/server.js:32053-32083`
**Symptom**: Architectural inconsistency. city macros (startStream/endStream/followStream/unfollowStream/listStreams) registered inline instead of in `server/domains/city.js`. Hard to maintain.
**Fix size**: SMALL — mechanical extraction (~30 min)

### I7. music lens — minimal macro coverage ⚠️
**File**: `server/domains/music.js`
**Symptom**: Only 7 macros registered; music lens page probably calls more. Verify.
**Fix size**: MEDIUM (during music lens parity rebuild)

### I8. atlas lens — `/api/atlas/*` endpoints missing ⚠️
**File**: `concord-frontend/app/lenses/atlas/page.tsx`
**Symptom**: Uses useQuery to fetch `/api/atlas/coverage` and `/api/atlas/taxonomy`; server has zero `/api/atlas/*` routes.
**Fix size**: MEDIUM (during atlas lens parity rebuild)

### I9. 8 write-only tables — data orphaned ⚠️
Agent flagged these as W-only; each needs a read path:

| Table | Migration | Severity | Fix |
|---|---|---|---|
| `affect_events_log` | 110 | HIGH | Add `affect.affectHistory` macro + `GET /api/worlds/:worldId/npcs/:npcId/affect-history` |
| `homework_submissions` | 165 | MEDIUM | Add `classroom.list_submissions` + `classroom.grade_submission` macros |
| `land_claim_events` | 135 | MED-HIGH | Add `land-claims.history` macro |
| `npc_ambition_log` | 189 | MEDIUM | Add `/api/worlds/:worldId/ambition-log` |
| `npc_skill_acquisitions` | 127 | LOW-MED | Add `npc-economy.skill-acquisitions` diagnostics |
| `procgen_region_visits` | 137 | MEDIUM | Add `procgen_regions.getUserVisitHistory` (blocks achievements) |
| `social_ranking_audit` | 227 | MEDIUM | Add `social-ai.get_ranking_audit` (transparency surface) |
| `war_town_captures` | 186 | LOW | Add `war_campaigns.getTownCaptureHistory` |

### I10. 13 SCAFFOLD lens directories — quick-win wiring ⚠️
Agent 4 found 13 lenses with UI but 0 macros (would 404 on every interaction). Top 5 by quick-win leverage:

| Lens | LOC | Effort | Notes |
|---|---|---|---|
| world-creator | 261L | 3-4h | Unlocks creator-authored worlds |
| emergency-services | 511L | 4-5h | Real-time emergency dispatch game system |
| bounties | 207L | 2-3h | Creator economy incentive system |
| ux-suite | 164L | 0h | Already functional |
| forecast | 157L | 2h | Weather + ecology predictions |

Full SCAFFOLD list: bounties, cognitive-replay, death-insurance, deities, dx-platform, emergency-services, forecast, law-enforcement, world-creator, ux-suite, crisis-ops, expedition-journal.

### I11. 5 DEEP lenses need extraction to dedicated domain files ⚠️
These have substantial inline macro registrations but no `server/domains/<lens>.js`:

| Lens | LOC | Inline macros | Action |
|---|---|---|---|
| understanding | 977L | 16 | Extract → domains/understanding.js (mechanical move) |
| import | 1034L | 4-10 | Build out — universal platform importer |
| command-center | 2210L | 0 | Build out — system dashboard (depends on /api/health, /api/system/metrics) |
| worldmodel | 405L | 16 | Extract → domains/worldmodel.js |
| system | 764L | 20 | Extract → domains/system.js |

### I12. 6 MODERATE lenses need domain extraction ⚠️
forge (18 inline), mesh (20 inline), lattice (8), export (6), and 2 others. All have manifest entries, just need extraction.

---

## 🟢 NICE-TO-HAVE — defer

### N1. 161 lenses use the legacy `registerLensAction` pattern ✅
**Source**: Agent 5 fast-scan of remaining 168 lenses with domain files
**Symptom**: Architectural inconsistency — 161 lenses use `registerLensAction` (legacy) instead of `register()` (newer pattern that all 6 rebuilt lenses use). All work in production, this is pure pattern-debt.
**Fix size**: 40 min per 20 lenses (mechanical refactor)
**Decision**: defer indefinitely — only fix when touching the lens for other reasons.

### N2. 62 read-only tables — features render empty ⚠️
Agent 3 found 62 tables that are queried but never written. Of these, **3 are critical** (already in I-series above): `player_world_metrics` ❌ (false positive — agent missed the writes in `lib/ecosystem/score-engine.js:25` and `emergent/personal-beat-scheduler.js:174,181`), `creative_artifacts`, `skill_evolution_unlocks`.

Most of the other 59 are nice-to-have features that show empty (NPC gear, npc_knowledge, npc_relationships, npc_residency, player_quests, player_resource_bars, quest_objectives, quest_rewards, etc.). Each is a feature that *appears* to exist but renders nothing. Fix when the corresponding feature is rebuilt for parity.

### N3. Schema collisions to consolidate ⚠️
- `marketplace_dtu_listings` (✅ working — Sprint cleanup) vs `marketplace_economy_listings` (orphaned) vs `marketplace_listings` (verify use)
- `dtus` (✅ working) vs `dtu_store` (orphaned)
- `player_quests` (read-only) vs `player_quest_progress` vs `quest_completions` (verify actual source)
- `player_world_metrics` (✅ verified active — agent was wrong)

Decision: defer schema consolidation. Document the canonical-vs-orphaned mapping in `docs/AUDIT_INVENTORY.md` when refreshing it.

### N4. Wallet schema oddities ⚠️
- `wallet_id` table — sounds like a column, not a table
- `wallet_credit_failed` — verify
Defer to wallet lens parity rebuild.

### N5. Music — `music_foresight_init` table suggests one-time seeding ⚠️
Verify `initMusicForesight()` is called in `server.js` boot. Fix during music lens rebuild.

---

## ❌ FALSE ALARMS — verified non-issues

These were flagged by agents but verification showed they're fine. Documented to prevent re-discovery:

- **STATE.wallets** ❌ — Map exists but wallet balance lives in `economy_ledger` (Map is a cache shim, not source of truth). NOT data loss.
- **player_world_metrics** ❌ — Agent grep missed the writes in `lib/ecosystem/score-engine.js:25` (INSERT OR IGNORE) and `emergent/personal-beat-scheduler.js:174, 181` (UPDATE). Table is symmetric.
- **dtu-marketplace lens** ❌ — Directory doesn't exist. Marketplace functionality lives in `/lenses/marketplace/` (no rebuild needed).
- **evo-asset lens** ❌ — Directory doesn't exist. Functionality lives in Concordia game mechanics.
- **ATS module 501s** ❌ — `server/affect/index.js` exists with all exports. The 6 `501 ATS not loaded` returns are defensive guards that won't trigger.
- **ingest-engine 501s** ❌ — exists with all 4 exports. Defensive.
- **addAuthoredNPC 501** ❌ — exists in content-seeder.js:605. Defensive.
- **145 dead domain files claim** ❌ — direct grep confirmed all 278 domain files are imported.

---

## Detailed source reports

Full agent outputs preserved at:
- `/tmp/smoking-gun-lenses.md` — top 11 unrebuilt lenses (Agent 1, 147 lines)
- `/tmp/smoking-gun-state-maps.md` — all 23 STATE Maps (Agent 2, 257 lines)
- `/tmp/smoking-gun-asymmetric-tables.md` — 70 asymmetric tables (Agent 3, 417 lines)
- `/tmp/smoking-gun-empty-lenses.md` — 48 unrebuilt lens directories (Agent 4, 420 lines)
- `/tmp/smoking-gun-remaining-lenses.md` — 168 remaining lenses fast scan (Agent 5, 128 lines)

Note: these are ephemeral tmp files in the build container. If the container is recycled they'll be lost. The salvageable findings are consolidated here in this tracker file (which lives in git).

---

## Recommended attack order

1. **Today / this sprint** (cheap CRITICAL): C5 (healthcare 1-line rename), I6 (city macros extraction). ~1h total.
2. **Cleanup sprint** (data integrity): C2 + C3 + C4 (gameProfiles + customPersonas + councilProposals). Same playbook as the last cleanup commit. ~1 day.
3. **Education sprint** (production blocker): C1 — full lens rebuild with all 20 endpoints. Slot into the lens-rebuild rotation as the next high-value lens.
4. **Per-lens rebuilds** (in any order): C7 (each lens's STATE Map → DB) folds into the lens's parity sprint. Same for I7/I8 (music/atlas).
5. **Background polish**: I9 (write-only tables → read paths), I10 (13 SCAFFOLDs → MVP wiring). Drip during research-parity work.
6. **Indefinite defer**: N1 (legacy pattern), N2 (62 read-only tables), N3 (schema consolidation). Only fix when touching for other reasons.

---

## How to use this tracker

- When picking the next lens to rebuild: search this doc for the lens name, you'll find any pre-existing gaps documented.
- When closing an item: change the heading to `### ✅ C1. ...` and add a one-line note about the fix commit.
- When verifying a ⚠️ item: re-grep the claim. If it stands, change to ✅. If not, move it to the FALSE ALARMS section.
- Re-run the smoking-gun audit periodically (the 5 Explore agents) to catch new gaps as the codebase grows.
