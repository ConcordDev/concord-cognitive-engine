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
`governorTick()` in `server.js` drives all emergent simulation: 33 wired modules in `server/emergent/` running at varying frequencies (every tick, every 5th, every 20th, etc.). Always wrap new heartbeat additions in `try/catch` — a module crash must never stop the tick.

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

All five Ollama services run with `OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE=q8_0` to use the Blackwell tensor cores and halve KV cache memory. `initThreeBrains()` (legacy name; now probes five) probes them on startup and auto-pulls models. `ctx.llm.chat()` routes to conscious; falls back to subconscious. Vision queries route through `server/lib/vision-inference.js#callVision` which reads `BRAIN_VISION_URL`.

### 175-lens frontend
`concord-frontend/app/lenses/` has 182 directories (175 lenses + system pages). Each lens page calls its backend domain macro. Lens feature specs live in `server/lib/lens-features.js` and `server/lib/lens-features-extended.js`. **~20–30 lenses have full backend implementations; ~100 are declared but backend-stub only.** Use `npm run score-lenses` to audit current implementation completeness.

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
SQLite via `better-sqlite3`. Synchronous, in-process, no ORM. Migrations in `server/migrations/` (068 migrations as of last audit), run automatically at startup and manually via `npm run migrate`. Schema version tracked in `schema_version` table.

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
- Heartbeat-registry pattern — modules register at one site instead of editing `governorTick()`. Currently registered: social-npc-bridge (5), npc-knowledge-bridge (10), metrics-decay (20), fauna-spawner (30), eco-expiry-sweep (5), refusal-field-sweep (1), corpse-cleanup (10)

### Built but not yet wired to gameplay
| System | Location | Missing connection |
|---|---|---|
| GameJuice feedback system | `components/world-lens/GameJuice.tsx` | Not receiving level-up, combat, quest-complete events from backend |
| NPC click → dialogue panel | `components/concordia/dialogue/DialoguePanel.tsx` | No event handler wiring click on world NPC → `GET /api/world/dialogue/:npcId` |
| Rapier3D collision | `lib/world-lens/physics-world.ts` | Installed, not integrated with world movement |
| World event auto-generation | `server/lib/world-events.js` | No scheduler generating recurring events on world startup |
| Sovereign Mass Raid combat phases | `server/lib/sovereign/raid-event.js` | Phase progression on join works; phase 4 dome-shrink VFX + draftSovereignManifestation rendering not yet in CombatHUD |
| EvoEcosystem → EvoAsset evolution feedback | `lib/evo-asset/scheduler.js` consumes Shadow DTUs from `sovereign_archive`, but recorded archive entries have no consumer for "manifested fused power" yet |

### Missing (needs building)
- Content discovery surface: no system surfacing active district events/quests/recipes/fauna to the player
- Multiplayer interaction: presence works; trade/emote/direct interaction not wired
- New world lore seeding: only Concordia hub + four sub-worlds (fantasy / superhero / crime / cyber) are seeded; new worlds get no authored seed
- New user routing: onboarding flow exists but first-time users not confirmed routed through it

---

## Recent shipped work (most → least recent)

| Commit | What landed |
|---|---|
| Concordant Web | 8 cross-world authored major characters + 3 factions + Concordant Law + Sovereign Refusal Archive + Mass Raid scaffold + Refusal Field new kinds (numbers/dome/win refused) |
| EvoEcosystem | Migrations 094–096; fauna spawner; loot tables; butcher route; cooking pipeline (raw→cooked→buff); active-effects table; Concordia neutral-zone middleware; Refusal Field; Three Pillars seed |
| v2.0 Bidirectional Creative OS | Heartbeat registry; recipe substrate; social-NPC bridge; music/blueprint/medical instantiation; multi-avatar; federation; realtime; DAW layering |
| Audit pass | Heap → 32GB; lifted 9 artificial caps; fixed 6 broken items + 14 polish items; +5 integration / migration tests |

---

## Key Invariants

- **95% creator share is hardcoded and immutable.** Do not change this.
- **Heartbeat modules must never throw.** Always wrap in `try/catch`.
- **DTU originals are never deleted.** Only tombstoned. Lineage always preserved.
- **NPC secrets (narrative_context.secret) must not be passed to LLM prompts.** They are for human authors and branch conditions only. The narrative bridge enforces this.
- Migrations are append-only. Never modify an existing migration file.
- `CONCORD_NO_LISTEN=true` + `NODE_ENV=test` both suppress port binding for tests.
- The frontend `build` script runs `prophet-check` (repair cortex pre-build analysis) before `next build`. Build blockers will exit 1.

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
