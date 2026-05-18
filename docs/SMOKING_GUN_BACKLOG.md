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

### ❌ I10. 13 SCAFFOLD lens directories — FALSE ALARM (verified Sprint 8)
Agent 4 classified 13 lenses as SCAFFOLD because they had "0 inline macros in their own name AND no dedicated domain file". But Concord deliberately allows lenses to call macros from ANY existing domain (chat.timeline, deity.list, insurance.list_for_user, dx.onboarding_progress, etc.). Direct grep against all 13 SCAFFOLD page.tsx files shows ZERO genuinely missing macros — every (domain, name) pair the pages call resolves to an existing handler.

Verified resolutions:
| Lens | Calls | Resolves to |
|---|---|---|
| bounties | bounty.list_open, bounty.stake | server.js inline |
| forecast | forecast.recent, forecast.compose | server.js inline |
| world-creator | /api/worlds (REST) | routes/worlds.js |
| cognitive-replay | chat.timeline | chat domain |
| death-insurance | insurance.list_for_user, write_contract, revoke | insurance domain |
| deities | deity.list, deity.pilgrimage | deity domain |
| dx-platform | dx.onboarding_progress | dx domain |
| ux-suite | (no API calls — pure UI showcase) | n/a |
| emergency-services | (no macro calls visible) | n/a |
| law-enforcement, crisis-ops, expedition-journal | (no macro calls visible) | n/a |

The "SCAFFOLD" framing was wrong — these lenses are all functional. The 13 lens directories without a dedicated server/domains/<lens>.js are just an architectural convention difference (inline vs extracted), not a wiring gap.

### ⚠️ I11. 5 DEEP lenses — extraction is OPTIONAL polish, not a bug
These have substantial inline macro registrations directly in server.js. Extracting them to dedicated `server/domains/<lens>.js` files is a code-organization improvement but doesn't change runtime behavior. Each one is fully wired today:

| Lens | LOC | Inline macros | Status |
|---|---|---|---|
| understanding | 977L | 16 | Wired, optional extraction |
| import | 1034L | 4-10 | Wired |
| command-center | 2210L | 0 | Calls REST endpoints (/api/health, /api/system/metrics, /api/guidance/*) — all exist |
| worldmodel | 405L | 16 | Wired |
| system | 764L | 20 | Wired |

### ⚠️ I12. 6 MODERATE lenses — same as I11, optional polish
forge (18 inline), mesh (20), lattice (8), export (6), etc. All have inline macros that resolve. Extraction is mechanical refactor for consistency, not a bug fix.

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
- **C6 world `mainland` domain** ❌ — `domain: 'mainland'` at world/page.tsx:4803 is a JSX prop on QuestLog component, NOT a macro call.
- **C7 5 lens domains in-memory data loss** ❌ — All 5 (accounting/healthcare/legal/food/education) have saveStateIfAvailable helpers calling globalThis._concordSaveStateDebounced → state_snapshots → hydrateLensState on boot. Mechanism fully wired.
- **I8 atlas `/api/atlas/coverage` missing** ❌ — atlas page.tsx makes NO /api/atlas/* direct calls.
- **I10 13 SCAFFOLD lenses** ❌ — Sprint 8 audit verified every macro the page.tsx files call resolves to an existing handler (inline in server.js or in a sibling domain file).
- **I11+I12 11 DEEP/MODERATE lenses** ❌ — All have inline-registered macros that work. Extraction to dedicated domain files is optional polish, not a bug fix.

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

## Attack order — STATUS

✅ **All actionable items closed** as of Sprint 8. Remaining items are policy decisions, intentional architectural choices, or false alarms.

**Closed across 8 sprints (24/24 verified-and-resolved)**:
- Sprint A (`e28b664`): chat_scheduled_tasks alive + 3 calendar asymmetric tables balanced + STATE.councilVotes → council_dtu_votes + STATE.marketplaceListings → marketplace_dtu_listings
- Sprint 1 (`813f06f`): C5 healthcare action rename + I6 city macros extracted
- Sprint 2 (`813f06f`): C2 gameProfiles + C3 customPersonas + C4 councilProposals → durable
- Sprint 3 (`45dc9c1`): I9 — 8 write-only audit tables now have read macros
- Sprint 4 (`5d5b13a`): C7 false alarm verified + lens snapshot safety-net heartbeat
- Sprint 5 (`8831562`): C1 education — 20 missing /api/learning endpoints implemented
- Sprint 6 (`ed8a503`): I2 feeds + I4 consent → durable; I8 atlas false alarm verified
- Sprint 7 (`9662023`): I3 entities + I5 cognitiveDigitalTwins now in snapshot serialize/hydrate
- Sprint 8 (this commit): I10/I11/I12 verified false alarms — all "SCAFFOLD" lenses already wired

**Remaining (low priority)**:
- **I1 macro_call_log billing** — policy: FF_MACRO_BILLING defaults to 0 in prod intentionally. Decide: enable billing OR remove dashboard read surface.
- **I7 music lens minimal macro coverage** — fold into eventual music lens parity rebuild.
- **N1 161 lenses use legacy registerLensAction** — architectural debt; defer until touching each lens.
- **N2 remaining 54 read-only tables** (8 of 62 fixed in I9) — drip during feature rebuilds.
- **N3-N5 schema collisions / wallet weirdness / music_foresight_init** — defer to per-feature rebuilds.

---

## How to use this tracker

- When picking the next lens to rebuild: search this doc for the lens name, you'll find any pre-existing gaps documented.
- When closing an item: change the heading to `### ✅ C1. ...` and add a one-line note about the fix commit.
- When verifying a ⚠️ item: re-grep the claim. If it stands, change to ✅. If not, move it to the FALSE ALARMS section.
- Re-run the smoking-gun audit periodically (the 5 Explore agents) to catch new gaps as the codebase grows.
