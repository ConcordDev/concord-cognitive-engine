# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What This Is

Concord Cognitive Engine is a cognitive operating system — a knowledge platform with 175 domain lenses, four parallel LLM brains, a self-compressing knowledge substrate (DTUs), a creator economy with perpetual royalties, a seven-layer mesh network, and a 3D civilization simulator (Concordia). Live at concord-os.org. 1.3M+ lines, one developer.

---

## Commands

### Backend (`server/`)
```bash
npm run dev          # node --watch server.js (hot reload)
npm start            # node server.js (production)
npm test             # node --test tests/**/*.test.js
npm run test:watch   # watch mode
npm run test:coverage
node --test --test-name-pattern="<pattern>" tests/path/to/file.test.js  # single test
npm run lint         # eslint
npm run lint:fix
npm run migrate      # apply pending DB migrations
npm run migrate:status
npm run check-deps   # validate emergent module dependency graph (CI)
npm run smoke        # smoke test script
```

### Frontend (`concord-frontend/`)
```bash
npm run dev          # next dev
npm run build        # runs prophet-check pre-build, then next build
npm run lint
npm run type-check   # tsc --noEmit
npm run test         # vitest (watch)
npm run test:run     # vitest run (CI)
npm run validate-routes    # check route/lens manifest consistency
npm run score-lenses       # score lens implementation completeness
```

### Full stack (Docker)
```bash
docker-compose up           # starts backend + frontend + 4 Ollama instances
./setup.sh                  # first-time: deps + data dirs + .env + migrations
./startup.sh                # bare metal startup helper
```

### Environment variables
The server requires `JWT_SECRET` in production. Without it, a random secret is generated (sessions don't survive restart). `DB_PATH` defaults to `server/data/concord.db`. `PORT` defaults to 5050. `CONCORD_NO_LISTEN=true` prevents the server from binding a port (used in tests). Five Ollama URLs: `BRAIN_CONSCIOUS_URL` (11434), `BRAIN_SUBCONSCIOUS_URL` (11435), `BRAIN_UTILITY_URL` (11436), `BRAIN_REPAIR_URL` (11437), `BRAIN_VISION_URL` (11438 — LLaVA).

**Heap & cap tuning** (32GB-deployment defaults — override on smaller boxes):
- `MAX_OLD_SPACE_SIZE=32768` and start node with `--max-old-space-size=32768`. Keep both in sync; the memory-pressure watchdog reads the env var.
- `CONCORD_MAX_SHADOWS` (default 50000) — cap for `STATE.shadowDtus`.
- `CONCORD_PLAYLIST_LIMIT` (100), `CONCORD_NPC_KNOWLEDGE_BATCH` (1000), `CONCORD_SOCIAL_BRIDGE_BATCH` (2000), `CONCORD_FAUNA_SPAWN_BATCH` (500), `CONCORD_FEED_DTUS_PER_HOUR` (10000), `CONCORD_LLM_QUEUE_DEPTH` (1000), `CONCORD_DIALOGUE_MAX_CONCURRENT` (50), `CONCORD_DOWNLOADS_PER_USER` (25).
- `CONCORD_FEDERATION_TOKEN` — when set, federation `/api/world/social-shadows` requires Bearer auth.

---

## Architecture

### The monolith: `server/server.js`
62,000+ lines. All routes, middleware, startup, and tick logic live here. It is intentionally monolithic (comment in code: "for IP protection"). Adding new routes means adding them directly to this file. It imports from `server/lib/`, `server/emergent/`, `server/domains/`, and `server/routes/`.

### Three-gate permission system
Every frontend API call passes three gates in `server.js`:
1. **authMiddleware** — `publicReadPaths` array (path prefix allowlist for unauthenticated GET)
2. **runMacro** — `publicReadDomains` object (domain+macro allowlist)
3. **Chicken2** — `_safeReadPaths` + `safeReadBypass` boolean

### The macro system
Frontend calls `POST /api/lens/run` with `{ domain, name, input }`. This routes to `runMacro(domain, name, input, ctx)` in `server.js`. All 175 lenses expose their functionality as domain macros (e.g., `runMacro("chat", "respond", {...})`). Domain logic lives in `server/domains/<domain>.js`.

### Heartbeat tick (every 15s)
`governorTick()` in `server.js` drives all emergent simulation. Two registration patterns coexist:
- **Per-entity inline ticks** (33+ modules in `server/emergent/`) running at varying frequencies (every tick, every 5th, every 20th, etc.). See `WIRING_SPEC.md` for the full table.
- **Singleton periodic modules** (7 registered + 12 wrapped via `runHeartbeatModule`) for system-wide work — social-npc-bridge (5 ticks), npc-knowledge-bridge (10), metrics-decay (20), fauna-spawner (30), eco-expiry-sweep (5), refusal-field-sweep (1), corpse-cleanup (10), plus the wrapped ones (walker-journey, creature-bond-decay, combat-state-tick, weather-advance, npc-schedule-replan, news-log-pull, council-theater-tick, reputation-badge-sweep, citation-quest-bridge-tick, concord-link-walker-tick, world-event-scheduler-tick @ 40, world-event-finalize-tick @ 4).

Always wrap new heartbeat additions in `try/catch` — a module crash must never stop the tick. Counter `concord_heartbeat_ticks_total` (server.js:5592, alert `ConcordHeartbeatStopped` in `monitoring/prometheus/alerts.yml:60`) increments per tick; rate==0 for >60s indicates the loop has frozen. Skipped ticks (when a previous tick is still running) are NOT counted — observable gap.

### DTU substrate
Discrete Thought Units are the atomic knowledge format. Four layers: `human` (readable summary), `core` (structured claims/definitions), `machine` (tags, embeddings, verifier), `artifact` (optional binary at `./data/artifacts/{dtuId}/`). Regular DTUs consolidate into MEGA (5–20 originals) then HYPER (50–200) at 33:1 compression every 30 ticks. There is **no hard DTU ceiling**; memory pressure is governed by `server/lib/memory-pressure.js` against `MAX_OLD_SPACE_SIZE`. With the 32GB-heap default the substrate comfortably holds ~1.5M DTUs.

### Five-brain architecture (four cognitive + LLaVA vision)
Default models tuned for the **NVIDIA RTX PRO 4500 Blackwell** (32GB GDDR7, 5th-gen tensor cores). Override any model via env var.

| Brain | Default model (q4_K_M) | VRAM | Port | Role |
|---|---|---|---|---|
| Conscious | `qwen2.5:32b-instruct-q4_K_M` | ~18GB | 11434 | Chat, deep reasoning, council |
| Subconscious | `qwen2.5:7b-instruct-q5_K_M` | ~5GB | 11435 | Autogen, dream, synthesis |
| Utility | `qwen2.5:3b-instruct-q5_K_M` | ~2GB | 11436 | Lens actions, quick tasks (65% of requests) |
| Repair | `qwen2.5:1.5b-instruct-q5_K_M` | ~1GB | 11437 | Error detection, auto-fix |
| Vision | `llava:13b-v1.6-vicuna-q4_K_M` | ~9GB | 11438 | LLaVA — image understanding, food vision, doc layout |

All five Ollama services run with `OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE=q8_0` to use the Blackwell tensor cores and halve KV cache memory. `initFiveBrains()` probes all five (4 cognitive + 1 multimodal/vision) on startup and auto-pulls models. `ctx.llm.chat()` routes to conscious; falls back to subconscious. Vision queries route through `server/lib/vision-inference.js#callVision` which reads `BRAIN_VISION_URL` and routes via `BRAIN.multimodal` / `BRAIN_CONFIG.multimodal`.

### 175-lens frontend
`concord-frontend/app/lenses/` has 185 directories (175 lenses + system pages). Each lens page calls its backend domain macro. Lens feature specs live in `server/lib/lens-features.js` (20 universal features) and `server/lib/lens-features-extended.js` (**58 lens entries spanning lensNumber 66–123, contiguous, no duplicates** — verified by `tests/lens-features-extended.test.js`). Categories: GOVERNANCE_EXT (8), SCIENCE_EXT (6), AI_EXT (7), AI_COGNITION (10), SPECIALIZED_EXT (13), BRIDGE (1), CREATIVE (2), SPECIALIZED (11). **~30+ lenses have full production-grade implementations (chat, code, healthcare, education, dtus, marketplace, alliance, anon, atlas, attention, calendar, council, debate, eco, fractal, hypothesis, lab, legal, meta, neuro, parenting, quantum, vote, whiteboard, accounting, agriculture, photography, physics, and more).** Several remaining lenses have analysis macros that need plumbing to DTU/LLM/cross-domain reuse. Use `npm run score-lenses` to audit current implementation completeness.

### Concordia (World Lens)
3D civilization simulator inside the platform. Key directories:
- `concord-frontend/lib/world-lens/` — Three.js terrain, building, avatar, physics (28 TS files, ~428KB)
- `concord-frontend/lib/concordia/` — Gait synthesis, FABRIK IK, secondary physics, combat logic
- `concord-frontend/components/world/` — IsometricEngine, AvatarSystem3D, CombatHUD, GameJuice
- `concord-frontend/components/concordia/` — HUD, skills, dialogue, quests, world UI
- `server/lib/npc-*.js` — 11 NPC modules (simulator, behaviors, archetypes, family, gear, jobs, relations, spawning)
- `server/emergent/quest-engine.js` — In-memory quest engine (createQuest, prerequisite chains, breadcrumb protocol)
- `server/lib/oracle-brain.js` — LLM quest chain + dialogue generation
- `server/lib/narrative-bridge.js` — Enriches oracle-brain calls with authored NPC/faction context
- `server/lib/content-seeder.js` — Seeds authored world content at startup (idempotent)
- `content/world/` — Authored factions, NPCs (with backstories), lore events
- `content/quests/` — Authored quest chains (onboarding, 7-quest main arc, 8 faction quests)

### Database
SQLite via `better-sqlite3` (in `dependencies`, not optional — the server hard-requires it). Synchronous, in-process, no ORM. Migrations in `server/migrations/` (**101 migrations through `101_player_inventory_world_scope.js`**), run automatically at startup and manually via `npm run migrate`. Schema version tracked in `schema_version` table. Migration 101 added `world_id TEXT NOT NULL DEFAULT 'concordia-hub'` to `player_inventory` so a player's items follow them per world (pre-101, switching avatars+worlds left items behind because the table only had `user_id` and cross-world inventory queries returned the wrong slice). Migration 100 extended `evo_assets` CHECK constraints to admit gameplay-derived kinds (`creature`, `craft`, `skill`, `drop`, `species`) — required for the gameplay-asset-bridge to actually persist events.

### Mobile
`concord-mobile/` — React Native + Expo v52. Real native app with BLE, WiFi P2P, geolocation, NFC, SQLite local store, wallet/marketplace. Not a web wrapper. Secure storage uses `expo-secure-store` (iOS Keychain / Android Keystore) on native and `WebCrypto` AES-GCM with a non-extractable key in IndexedDB on web — selected by `createSecureStorageForPlatform(Platform)` in `App.tsx`.

---

## Current Wiring Status (post-Concordant Web)

This section exists so future sessions don't repeat discovery work.

### Fully working end-to-end
- Auth (JWT + cookie), login/signup
- Chat system (WebSocket streaming, DTU context, web search, personality persistence)
- DTU creation, marketplace, citation royalties
- Skill progression tracking and mastery UI (combat skills via `skill:use` archive Sovereign Refusal Archive)
- Real-time world presence (spatial chunking, avatar interpolation, anti-cheat)
- World events (11 types, RSVP, DTU generation, entry fees)
- Faction/org creation, governance voting
- 3D world rendering (terrain, buildings, avatars with IK, weather, day/night)
- Content seeder + narrative bridge — seeds 24 authored NPCs (incl. Sovereign / Concord / Concordia / 5 Coalition + Web NPCs / Weaver of Echoes), 7 factions, 19 lore events, 7 hand-authored idle dialogue trees that bypass the LLM
- v2.0 recipe substrate (fighting_style_recipe / spell_recipe / blueprint), `scope='personal'` defaulting + `personal_dtus_never_leak` invariant, list-on-marketplace with tier pricing
- Social-NPC bridge — public timeline DTUs surface to NPC oracle prompts via Shadow DTUs every 5 ticks, with backend privacy gate
- Music DTU → soundscape (community tracks per district) + cross-world XP cascade
- Building blueprint → world spawn (with bounding-box overlap check + DELETE)
- Medical/research/engineering DTU → NPC knowledge (npc_knowledge table, surfaced in role-matched dialogue)
- Per-player four-axis metrics (ecosystem_score / concord_alignment / concordia_alignment / refusal_debt) with decay sweep
- Refusal Field — base-6 glyph algebra → time-bounded gates on death / harvest / hostility / consequence / numbers / dome / win, **persistent across restart** via migration 097
- Concordia (goddess) auto-selects warm/cold dialogue phase from `ecosystem_score` at the dialogue endpoint
- Mass Raid friendly-fire immunity wired into the `combat:attack` socket path
- Multi-avatar — migration 093 + `/api/avatars` CRUD + AvatarSwitcher UI; personal-locker queries scope by `avatar_id`; hotbar reads `localStorage.concordia:activeAvatarId`
- Federation export `/api/world/social-shadows` with optional `CONCORD_FEDERATION_TOKEN` Bearer auth + import pass tagged `federated_signal`
- Realtime fast-path for public timeline posts (`timeline:post` socket event) and active-effect application (`player:effect-applied`)
- DAW → soundscape ducking, world-scoped via `concordia:activeWorldId` localStorage hint
- Crafting UI lens (`/lenses/crafting`) with Mine / Browse Marketplace / Author tabs + inline tier-pricing modal + ActiveEffectsBar HUD
- Heartbeat-registry pattern — modules register at one site instead of editing `governorTick()`. Currently registered: social-npc-bridge (5), npc-knowledge-bridge (10), metrics-decay (20), fauna-spawner (30), eco-expiry-sweep (5), refusal-field-sweep (1), corpse-cleanup (10), world-event-scheduler
- World event auto-generation — `server/lib/world-event-scheduler.js` registered at `server.js:29359-29365` via heartbeat, generating recurring events on cadence
- New world lore seeding — `server/lib/content-seeder.js:36` `discoverSubWorlds()` auto-discovers any `content/world/<name>/` directory; new worlds with content seed automatically
- GameJuice receives level-up via `LevelUpJuiceBridge.tsx`; combat events via CombatHUD dispatch
- NPC click → dialogue wired: `ConcordiaScene.tsx:892` raycaster → `POST /api/worlds/:worldId/npcs/:npcId/dialogue` (`routes/worlds.js:805`) → `DialoguePanel.tsx`
- Player trade fully implemented in `server/lib/player-trade.js` (initiate/offer/ready socket flow)
- DTU auto-compression — wired inline in `governorTick` at `server.js:28970-29061`. Every `TICK_FREQUENCIES.CONSOLIDATION` (30) ticks: cluster regular DTUs into MEGAs via `runMacro("dtu","cluster")` → `runMacro("dtu","gapPromote")`, validate via `validateConsolidationQuality`, transfer edges via `transferEdgesToConsolidated`, archive sources via `demoteToArchive`, then repeat for MEGA→HYPER when MEGA population ≥ `HYPER_MIN_POPULATION` (15).
- Rapier3D collision is authoritative — `concord-frontend/lib/world-lens/physics-world.ts` integrated with `AvatarSystem3D.tsx:1565` (`physicsWorld.moveCharacter('player', ...)`); the `else` branch at `:1569` is a defensive null-check (Rapier hasn't loaded), not a bounds fallback. Y-clamp at `:1585` is terrain heightfield, not world bounds.
- Sovereign Mass Raid Phase 4 dome — backend phase `eternal` declares `dome_collapse` Refusal Field via `server/lib/sovereign/raid-event.js:32`; `concord-frontend/lib/world-lens/dome-barrier.ts` `attachDomeBarrier()` listens for `world:refusal-field` socket events and renders a shrinking transparent sphere in the scene; mounted by `ConcordiaScene.tsx`.
- EvoAsset feedback — `server/lib/evo-asset/scheduler.js` emits `evo:asset-promoted` socket event on each verified promotion (`scheduler.js:140-150`); `LevelUpJuiceBridge.tsx` subscribes and fires "Manifested fused power" toast + GameJuice fanfare.
- Glyph algebra is load-bearing — `server/lib/refusal-field.js:computeFieldComposition` composes active fields' glyphs via `glyphAdd`; `isCompoundRefusal` (strength ≥ 6) overrides ecosystem score in Concordia goddess dialogue tone selection at `server/routes/world-narrative.js`.
- Server-side combat anti-cheat — `_validateCombatReach` (live `cityPresence` distance vs. skill `range_m` capped at 80m global) + `_validateDamageCap` (`skill.max_damage * 2.5` or 500 hard cap) gate `/api/worlds/:worldId/combat/attack`. Pre-this-fix the server trusted client damage claims with no reach or magnitude check (real one-shot/cross-map hack risk). Tests pin the contract at `tests/combat-anti-cheat.test.js` (15/15).
- Player inventory is per-world — migration 101 added `world_id` (default `concordia-hub`) so items follow the player per world; `routes/player-inventory.js` GET and `lib/tool-tree.js#craftTool` both scope by `(user_id, world_id)`. Pre-this-fix switching worlds left items behind and cross-world queries returned the wrong slice.
- World-event rewards mint real CC — `lib/world-events.js#endEvent` is async and calls `mintCoins` per attendee with `event_reward:${eventId}:${userId}` refId for idempotency. Pre-this-fix the realtime "you got rewards" toast fired but the wallet stayed flat (the mint was never wired).
- Emergent simulation has a UI surface — `components/world/EmergentEventFeed.tsx` subscribes to 20 silent simulation events (entity:death, body:*, agent:insights, forgetting:cycle_complete, dream:captured, lattice:meta:*, attention:allocation, evo:asset-promoted, world:refusal-field, world:crisis*, weather:update, world:event:scheduled, faction-war:*, dtu:promoted, pain:wound_*) and renders them as a collapsible filter-by-channel feed. Mounted alongside `DistrictActivityFeed` in `app/lenses/world/page.tsx`.
- Heartbeat overrun is observable — Prom counter `concord_heartbeat_skipped_total` (declared at `server.js:5636`, incremented at `server.js:28800` when `_governorTickRunning` causes early-return); alert `ConcordHeartbeatOverrun` in `monitoring/prometheus/alerts.yml` (`rate(... skipped[5m]) > 0` for 5m). Sustained overrun means a tick block is taking longer than the 15s interval and starving the next tick.
- WebSocket event-shape registry — `server/lib/event-shapes.js` pins required + optional fields for the 20 highest-traffic events; `validateEvent(name, payload)` is called inline by `realtimeEmit` when `NODE_ENV !== 'production'` (early return in prod) and `console.warn`s on shape violations. Floor-only — refactoring all 105 emit sites to be guarded is post-deploy iteration.

### Built but not yet wired to gameplay
*(Empty — all prior items shipped.)*

### Missing (needs building)
*(No code-side gaps remain. The remaining work is content authoring + UX testing — neither requires engineering.)*
- Content discovery surfaced by `concord-frontend/components/world/DistrictActivityFeed.tsx` (mounted in `app/lenses/world/page.tsx`); it aggregates `/api/world/events`, `/api/worlds/:worldId/quests/active`, `/api/tools/recipes` per proximity.
- Emote system shipped — `concord-frontend/components/world/EmoteWheel.tsx` (6 emotes) + `concord-frontend/components/concordia/social/EmoteWheel.tsx` (8 emotes with animation field) + `concord-frontend/components/world-lens/AnimationManager.tsx` (444 LOC state machine); both wheels mounted in `app/lenses/world/page.tsx`.
- First-hour onboarding shipped — `register/page.tsx` → `/onboarding`; `FirstWinWizard` mounted in `AppShell.tsx`; `/api/guidance/first-win` + `/api/onboarding/*` + `/api/tutorial/first-cycle` endpoints live; tutorial chain (cook → eat → fight → commune) authored in `content/quests/onboarding.json`. End-to-end journey covered by `server/tests/e2e/first-cycle-journey.test.js` (Tier-3 integration test).

---

## Recent shipped work (most → least recent)

| Commit | What landed |
|---|---|
| Pre-deploy follow-on (May 2026) | Migration 101 (`player_inventory.world_id` — items now follow the player per world; tool-tree `craftTool` + `routes/player-inventory` scoped by `(user_id, world_id)`); server-side combat anti-cheat in `/api/worlds/:worldId/combat/attack` (`_validateCombatReach` reads live `cityPresence` against skill `range_m` capped at 80m, `_validateDamageCap` uses `skill.max_damage * 2.5` or 500 hard cap); world-event `endEvent` now mints **real CC** to attendees via `mintCoins` with `event_reward:${eventId}:${userId}` refId for idempotency (pre-fix the toast lied — the wallet stayed flat); heartbeat-skipped Prom counter `concord_heartbeat_skipped_total` + `ConcordHeartbeatOverrun` alert; NPC-secret leakage contract test (`buildNPCTraits` exported, structural omission + canary-scan defense-in-depth); content-seeder validators (`validateNpc`, `validateFaction`, `validateQuest`, `validateLoreEvent` — malformed records logged + skipped instead of corrupting state); migration 098 hub-id-reconciliation regression test; backup-restore round-trip integration test; LLM router + vision contract tests gated on `CONCORD_BEHAVIOR_TEST_LLM=true`; royalty cascade real-DB test against the actual `economy_ledger` schema; WebSocket `event-shapes.js` registry with `validateEvent` dev-mode-only validator; **emergent simulation UI** — new `EmergentEventFeed` floating panel surfaces 20 silent simulation events (entity:death / body:* / agent:insights / forgetting:cycle_complete / dream:captured / lattice:meta:* / attention:allocation / evo:asset-promoted / world:refusal-field / world:crisis* / weather:update / world:event:scheduled / faction-war:* / dtu:promoted / pain:wound_*) with channel filters + pause; world-page mounts it next to `DistrictActivityFeed`; SocketEvent union extended with `world:crisis` / `world:crisis-resolved`; +1 test file for combat anti-cheat (15/15 passing); test totals **9508 main + 1212 behavior = 10,720 / 0 fail** |
| Production Audit (May 2026) | Migration 100 (`evo_assets` CHECK extended for gameplay kinds); 4 load-bearing bugs **made actually load-bearing** — refusal-field glyph algebra (was decorative-by-bug, now strength≥6 truly gates compound-refusal phases), world-event scheduler (silently created 0 events due to wrong field names to `createEvent`), gameplay-asset-bridge (every event silently dropped — schema CHECK + missing `localPath`), lens manifest (10 duplicate `lensNumber` collisions, renumbered to 113–123 contiguous); heartbeat counter alert path comment fixed; quest-engine `require()` → `await import()` at server.js:42591; `agent_threads.accumulated_state_json` and `agent_thread_checkpoints.node_id` NOT NULL bugs in thread-manager; promoted `better-sqlite3` from optional to required; full route-inventory updates to API.md (onboarding, tutorial, creator-economy, openapi/docs, concord-link, black-market, world bazaar/perf-telemetry); Three-Gate sync (17 missing routes added to Gate 3); +6 new test files (Tier-2 contract: dtu-quality-scoring, refusal-algebra/strength-gating, world-event-scheduler, gameplay-asset-bridge, npc-schedules; Tier-3 E2E: first-cycle-journey); 56 pre-existing assertion failures resolved (brain-routing 5-brain inventory, lens-features 58/220→58/274 update, accumulator multi-tenant caps, citation consent, storage/session limits, oauth, openapi coverage threshold, social-pings rate test, economy 48h withdrawal hold, physics validation rescale loop, routes/media auth shape) |
| Concordant Web | 8 cross-world authored major characters + 3 factions + Concordant Law + Sovereign Refusal Archive + Mass Raid scaffold + Refusal Field new kinds (numbers/dome/win refused) |
| EvoEcosystem | Migrations 094–096; fauna spawner; loot tables; butcher route; cooking pipeline (raw→cooked→buff); active-effects table; Concordia neutral-zone middleware; Refusal Field; Three Pillars seed |
| v2.0 Bidirectional Creative OS | Heartbeat registry; recipe substrate; social-NPC bridge; music/blueprint/medical instantiation; multi-avatar; federation; realtime; DAW layering |
| Audit pass | Heap → 32GB; lifted 9 artificial caps; fixed 6 broken items + 14 polish items; +5 integration / migration tests |

---

## Key Invariants

- **Marketplace fees are hardcoded.**
  - DTU royalty-aware path (`/api/marketplace/purchaseWithRoyalties`): `creatorPool = price * 0.95`, `platformFee = price * 0.05` — 95% to creator pool.
  - Economic marketplace path (`/api/economic/marketplace/buy`): `MARKETPLACE_FEE: 0.04`, `CREATOR_SHARE: 0.70`, `ROYALTY_SHARE: 0.20`, `TREASURY_SHARE: 0.10`.
  - Token purchase fee (Stripe → Concord Coin): `TOKEN_PURCHASE_FEE: 0.0146`.
  - Creative marketplace constants (`server/lib/creative-marketplace-constants.js:422-440`): `PLATFORM_FEE_RATE 0.0146`, `MARKETPLACE_FEE_RATE 0.04`, `INITIAL_ROYALTY_RATE 0.21`, `ROYALTY_HALVING 2`, `ROYALTY_FLOOR 0.0005`, `MAX_CASCADE_DEPTH 50`.
  - Royalty cascade cap (`server/economy/royalty-cascade.js:180`): `MAX_ROYALTY_RATE = 0.30` of the sale price to ancestors. Seller always keeps ≥64.54% (100% − 5.46% fees − 30% royalty cap). Tested in `tests/royalty-cascade.test.js`.
  - **Do not change any of the above without governance approval.** They are constitutional invariants.
- **48-hour withdrawal hold.** `server/economy/withdrawals.js:23` — only credits older than `WITHDRAWAL_HOLD_HOURS = 48` are withdrawal-eligible. This is the anti-refund-exploit gate (sell → withdraw instantly → buyer refund → funds gone). Tests must seed credits with backdated `created_at` to exercise the withdrawal path.
- **Citation requires consent.** `server/economy/royalty-cascade.js:registerCitation` short-circuits with `citation_consent_not_granted` unless one of: parent DTU is public/published/global-scoped, parent creator toggled `allow_citation`, OR caller holds a purchased usage license. Tests must pass `parentDtu: { visibility: "public" }` or `hasPurchasedLicense: true` to exercise downstream cycle/persistence logic.
- **Heartbeat modules must never throw.** Always wrap in `try/catch`.
- **DTU originals are tombstoned by the forgetting-engine retention pathway** (`server/emergent/forgetting-engine.js:134, 155`), preserving lineage. The user-initiated `dtu:deleted` event hard-deletes; do not extend hard-delete paths to retention sweeps.
- **NPC secrets (narrative_context.secret) must not be passed to LLM prompts.** They are for human authors and branch conditions only. The narrative bridge enforces this at `server/lib/narrative-bridge.js:147`.
- **DTU consolidation is automatic** via inline pipeline in `governorTick` at `server.js:28970-29061` (every `TICK_FREQUENCIES.CONSOLIDATION = 30` ticks). Forms MEGAs from regular DTU clusters (size 5–20), then HYPERs from MEGA clusters (size 3–10) once MEGA population ≥ 15. Constants at `server.js:1399-1419`. Manual `compressToDMega()` / `compressToHyper()` (`server/economy/dtu-pipeline.js:326, 399`) still callable from macros.
- **Refusal Field glyph algebra is load-bearing.** `server/lib/refusal-field.js:applyTemporaryRefusal` (lines 59–76) computes a real per-entry glyph from `computeBase6Layer` + `glyphDiv`; `computeFieldComposition` accumulates them via `glyphAdd` (lines 175–222) and returns a `strength` numeric. Callers MUST branch on `strength >= 6` (`isCompoundRefusal`) for compound-refusal mechanics: Concordia goddess "deep cold" dialogue tone (`server/routes/world-narrative.js`), world-event suspension, and the dome-collapse Mass Raid phase (`server/lib/sovereign/raid-event.js`). Strength is hard-capped at 9. The May 2026 audit fixed two latent bugs that had silently kept `composedFrom` at 0 (calls to `.value` on objects that don't have one); regression tests live at `tests/refusal-algebra/strength-gating.test.js`. Time-bounded gates from the `FIELD_KINDS` table (death/harvest/hostility/consequence/numbers/dome/win) ALSO still enforce per-kind blocks via `isRefused()`.
- **Combat damage and reach are server-validated.** `routes/worlds.js#_validateCombatReach` and `_validateDamageCap` gate `/api/worlds/:worldId/combat/attack`. Reach uses the live `cityPresence` position; declared `skill.range_m` is capped at 80m globally. Damage is capped at `skill.max_damage * 2.5` or 500 hard. Never reintroduce a "trust the client damage field" path — the prior unguarded code was a real one-shot / cross-map hack risk and is regression-tested at `tests/combat-anti-cheat.test.js`.
- **Player inventory is per-world.** All `player_inventory` reads MUST scope by `(user_id, world_id)`. Migration 101 added the column with default `concordia-hub`; the `idx_player_inv_user_world` and `idx_player_inv_user_world_item` indexes are the canonical lookup paths. New code that does `WHERE user_id = ?` against `player_inventory` and forgets the world filter will leak items across worlds — re-introducing the pre-101 bug.
- **World-event rewards are minted, not pretended.** `lib/world-events.js#endEvent` is async and MUST call `mintCoins` with `event_reward:${eventId}:${userId}` refId. Pre-fix code path emitted only realtime toasts (`event:reward` socket event) — the wallet never updated. Idempotency lives in the refId; a re-run of `endEvent` won't double-mint.
- Migrations are append-only. Never modify an existing migration file.
- `CONCORD_NO_LISTEN=true` + `NODE_ENV=test` both suppress port binding for tests.
- The frontend `build` script runs `prophet-check` (repair cortex pre-build analysis) before `next build`. Build blockers will exit 1.

---

## Multi-tenant cap defaults (lifted from single-user pre-deploy)

Several caps were intentionally raised before multi-tenant deploy. If you find a test asserting the old value, the test is stale — update to the new default.

| Constant | Old | New | Env override |
|---|---|---|---|
| `MAX_DOMAIN_SIGNALS` (`server/lib/session-context-accumulator.js:29`) | 50 | **500** | `CONCORD_DOMAIN_SIGNALS` |
| `MAX_ACTIVE_LENSES` (same file:30) | 15 | **175** | `CONCORD_ACTIVE_LENSES` |
| `MAX_SESSION_HISTORY` (same file:28) | 30 | **300** | `CONCORD_SESSION_HISTORY` |
| `MAX_CONCURRENT_DOWNLOADS_PER_USER` (`server/lib/storage-constants.js:210`) | 5 | **25** | `CONCORD_DOWNLOADS_PER_USER` |
| `SESSION_LIMITS.MAX_CONCURRENT` (`server/emergent/schema.js:98`) | 5 | **50** | `CONCORD_DIALOGUE_MAX_CONCURRENT` |
| `MAX_ARCHIVED_SUMMARIES` (`server/lib/conversation-summarizer.js:26`) | 20 | **200** | `CONCORD_ARCHIVED_SUMMARIES` |

---

## Test suite

- `npm test` runs `node --test --test-force-exit --test-timeout=30000 'tests/**/*.test.js' 'tests/**/*-tests.js' && npm run test:behavior`
- Current state (May 2026 pre-deploy follow-on): **9508 main + 1212 behavior = 10,720 passing, 0 failing.**
- Tier-1 behavior harness (`tests/behavior/lens-behavior-smoke.behavior.js`) auto-derives one test per (domain, macro) from the live `MACROS` map; skips LLM-hint and destructive-hint macros (run with `CONCORD_BEHAVIOR_TEST_LLM=true` to include).
- Tier-2 contract tests pin load-bearing math (royalty cascade, DTU quality scoring, refusal-field strength gating, world-event scheduler cadence).
- Tier-3 E2E covers the cook → eat → fight → commune onboarding journey (`tests/e2e/first-cycle-journey.test.js`).
- `npm install` in `server/` is mandatory before first run — the codebase hard-requires `better-sqlite3`, `express`, `jsonwebtoken`, `yaml`, `uuid`. All declared in `package.json`; no native build dependencies on RTX-class boxes.

---

## Adding a New Lens

1. Create `server/domains/<name>.js` with exported macro handlers
2. Add domain to `server/lib/lens-manifest.js` and `server/lib/lens-features.js`
3. Create `concord-frontend/app/lenses/<name>/page.tsx`
4. Add route to `server.js` if the lens needs custom endpoints beyond the macro system
5. Run `npm run validate-routes` and `npm run score-lenses` to verify consistency

## Adding a Heartbeat Module

1. Implement module in `server/emergent/<module>.js`
2. Register in `server/emergent/module-registry.js`
3. Wire into `governorTick` in `server.js` at the appropriate tick frequency
4. Run `npm run check-deps` to validate no circular dependencies introduced
