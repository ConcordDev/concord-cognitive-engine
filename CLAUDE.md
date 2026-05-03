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
The server requires `JWT_SECRET` in production. Without it, a random secret is generated (sessions don't survive restart). `DB_PATH` defaults to `server/data/concord.db`. `PORT` defaults to 5050. `CONCORD_NO_LISTEN=true` prevents the server from binding a port (used in tests). Four Ollama URLs: `BRAIN_CONSCIOUS_URL` (11434), `BRAIN_SUBCONSCIOUS_URL` (11435), `BRAIN_UTILITY_URL` (11436), `BRAIN_REPAIR_URL` (11437).

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
Discrete Thought Units are the atomic knowledge format. Four layers: `human` (readable summary), `core` (structured claims/definitions), `machine` (tags, embeddings, verifier), `artifact` (optional binary at `./data/artifacts/{dtuId}/`). Regular DTUs consolidate into MEGA (5–20 originals) then HYPER (50–200) at 33:1 compression every 30 ticks. Memory ceiling: ~170,000 DTUs in-heap.

### Four-brain architecture
| Brain | Model | Port | Role |
|---|---|---|---|
| Conscious | qwen2.5:14b | 11434 | Chat, deep reasoning, council |
| Subconscious | qwen2.5:7b | 11435 | Autogen, dream, synthesis |
| Utility | qwen2.5:3b | 11436 | Lens actions, quick tasks (65% of requests) |
| Repair | qwen2.5:0.5b | 11437 | Error detection, auto-fix |

`initThreeBrains()` probes all four on startup and auto-pulls models if Ollama is reachable. `ctx.llm.chat()` routes to conscious; falls back to subconscious if conscious fails.

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

## Current Wiring Status (as of last full audit)

This section exists so future sessions don't repeat discovery work.

### Fully working end-to-end
- Auth (JWT + cookie), login/signup
- Chat system (WebSocket streaming, DTU context, web search, personality persistence)
- DTU creation, marketplace, citation royalties
- Skill progression tracking and mastery UI
- Real-time world presence (spatial chunking, avatar interpolation, anti-cheat)
- World events (11 types, RSVP, DTU generation, entry fees)
- Faction/org creation, governance voting
- 3D world rendering (terrain, buildings, avatars with IK, weather, day/night)
- Content seeder + narrative bridge (wired at startup — seeds factions, NPCs, lore, quest chains)

### Built but not yet wired to gameplay
| System | Location | Missing connection |
|---|---|---|
| Audio engine + 16 district soundscapes | `lib/daw/engine.ts`, `components/world-lens/SoundscapeEngine.tsx` | Not initialized on world entry; SFX not connected to GameJuice triggers |
| GameJuice feedback system | `components/world-lens/GameJuice.tsx` | Not receiving level-up, combat, quest-complete events from backend |
| NPC click → dialogue | `components/concordia/dialogue/DialoguePanel.tsx` | No event handler wiring click on world NPC → `GET /api/world/dialogue/:npcId` |
| Emergent quest delivery | `server/emergent/quest-engine.js`, `server/lib/quest-emergence.js` | No scheduler running `quest-emergence` on interval; no frontend notification |
| Rapier3D collision | `lib/world-lens/physics-world.ts` | Installed, not integrated with world movement |
| DAW UI ↔ audio engine | `concord-frontend/app/lenses/studio/` | Piano roll / mixer UI not wired to `lib/daw/engine.ts` |
| World event auto-generation | `server/lib/world-events.js` | No scheduler generating recurring events on world startup |

### Missing (needs building)
- Content discovery surface: no system surfacing active district events/quests to the player
- Multiplayer interaction: presence works, no trade/emote/direct interaction
- Crafting UI: `server/lib/crafting/craft-engine.js` backend exists, no frontend
- New world lore seeding: only one authored world foundation; new worlds get no authored seed
- New user routing: onboarding flow exists but first-time users not confirmed routed through it

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
