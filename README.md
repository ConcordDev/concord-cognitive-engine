# Concord Cognitive Engine

**A cognitive operating system.**

232 domain lenses. Five parallel AI brains. A self-compressing knowledge substrate. A creator economy with perpetual royalties. A seven-layer mesh network that works without internet. A 3D civilization simulator with a 13-layer embodied substrate. Constitutional governance enforced in code. Security intelligence with collective immunity.

**over 2 million+ lines of code. One developer.**

**Live at [concord-os.org](https://concord-os.org)**-currently server is down, will be back up when I clock out

-----

## What This Is

Concord is a platform where every domain of human knowledge — from physics to plumbing, finance to film production, materials science to music — lives inside a unified substrate. Each domain has its own full-featured interface (a "lens"), its own AI pipeline routed to the right brain for the job, and its own economy where creators earn 95% of every transaction with perpetual royalty attribution.

The knowledge substrate isn't a database. It compresses as it grows — individual knowledge units consolidate into larger structures at a ~33:1 ratio, preserving lineage while reducing cost. The more people use it, the cheaper it gets to run.

The platform runs on five parallel LLMs with distinct cognitive roles (four cognitive + one vision), a mesh network that can transmit knowledge over radio, Bluetooth, or telephone if the internet goes down, and a security system where one threat detection protects every node on the network within 15 seconds.

> **Source-of-truth inventory.** Numbers in this README are verified against the working tree, but the canonical, reproducible inventory lives in [`docs/AUDIT_INVENTORY.md`](docs/AUDIT_INVENTORY.md) — every count there ships with the `grep`/`ls` command that produced it. When this file and the inventory disagree, the inventory wins. Run `npm run cartograph:static` (from `server/`) to regenerate the systems map.

-----

## Core Architecture

|Layer                             |What It Does                                                                                                                                                                                               |
|----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**232-Lens Interface**            |232 domain-specific cognitive applications — each with its own UI, API routes, AI actions, and economy connection. Many also mount a "rival-shape" silhouette (code → VS Code shell, music → session view, accounting → KPI strip) so each lens reads as the app it replaces while sharing one substrate. Not templates — first-party tools backed by the full substrate.|
|**Five-Brain Cognition**          |Five parallel Ollama instances tuned for the RTX PRO 4500 Blackwell — Conscious (`concord-conscious:latest`), Subconscious (qwen2.5:7b), Utility (qwen2.5:3b), Repair (qwen2.5:0.5b), Vision (qwen2.5vl:7b). ~800 brain-routed domain macros. Optional per-user BYO API keys route individual brain slots to external providers.|
|**DTU Substrate**                 |Discrete Thought Units — the atomic knowledge format. 11 content types, four internal layers (human/core/machine/artifact), MEGA/HYPER consolidation at ~33:1 compression, self-verifying content hashes. Automatic consolidation runs inline on the heartbeat.|
|**Creator Economy + Concord Coin**|95% creator share on the royalty-aware path (hardcoded, immutable). Royalty cascades through citation chains with a 30%-of-sale cap and a 0.0005 floor. Merit credit. 0% loans. Concord Coin via Stripe. 48-hour withdrawal hold as the anti-refund-exploit gate.|
|**Concord Mesh**                  |Seven transport layers (Internet, WiFi Direct, BLE, LoRa, RF/Ham, Telephone, NFC). DTUs are transport-agnostic — start a transfer over internet, finish over radio.                                         |
|**Concord Shield**                |Multi-tier security intelligence (ClamAV, YARA-X, Suricata+Snort, OpenVAS, Wazuh, Zeek). Collective immunity — one detection protects all nodes in one heartbeat tick. Pain memory never prunes threats.    |
|**Constitutional Governance**     |Three-tier rules (immutable/constitutional/policy). Council voting. Anti-gaming detection. Lattice READ/PROPOSE/COMMIT pipeline. Every action audited.                                                      |
|**World Lens (Concordia)**        |3D physics-validated civilization simulator. Procedural NPCs with daily routines, economies, schemes, and legacies. Multiplayer. User-created cities. Backed by a 13-layer embodied substrate (environment sensing, pain/repair coupling, dreams, forward-sim, faction strategy).|
|**Foundry**                       |In-platform world builder — author a 3D world from templates + natural-language rules, live-preview it, and publish it as an overlay. Migrations 191–192, lens #125.                                        |
|**Autonomous Substrate**          |178 emergent modules with biological lifecycle, bodies, sleep/dream cycles, cultural emergence, and knowledge generation — the system creates new knowledge without human input.                            |
|**Lattice Orchestrator**          |Wires the always-on emergent engines (contradiction/drift detection, cross-domain synthesis, federation polling, multi-mode reasoning) onto the heartbeat clock.                                            |

-----

## The 232 Lenses

Every lens is a standalone domain application with its own route, UI, real-time data, AI actions routed to the correct brain, and full economy integration. Each lens reads/writes to the shared DTU substrate, participates in cross-lens commerce (tipping, bounties, royalty cascades), and can be forked and governed independently. Lens feature specs live in `server/lib/lens-features.js`; run `npm run score-lenses` (from `concord-frontend/`) to audit implementation completeness against the manifest.

The list below is representative — the full per-directory inventory is in `docs/AUDIT_INVENTORY.md`.

**Knowledge & Research:** Research · Hypothesis · Reasoning · Metacognition · Graph · Atlas · Education · Science · Philosophy · History · Mathematics · Linguistics · Understanding

**Creative & Media:** Art · Music · Creative Writing · Studio · Film Studios · Artistry · Whiteboard · Game Design · Photography · Animation · Poetry · Forge

**Healthcare & Wellness:** Healthcare · Mental Health · Fitness · Nutrition/Food · Bio · Chem · Suffering · Pharmacy

**Engineering & Science:** Code · Database · Engineering · Materials Science · Physics · Astronomy · Geology · Environmental · Energy · Robotics

**Professional & Business:** Finance · Legal · Accounting · Real Estate · Marketing · HR · Consulting · Insurance · Supply Chain · Projects

**Trades & Construction:** Construction · Plumbing · Electrical · HVAC · Welding · Carpentry · Masonry · Automotive · Agriculture · Landscaping

**Lifestyle:** Travel · Fashion · Cooking · Crafting · Home · Parenting · Pets · Sports · DIY

**Social & Community:** Social · Feed · Forum · Message · Marketplace · Collab · Vote · Global · Alliance · Debate · Mentorship

**System & Governance:** Chat · Entity · Council · Organ · Tick · Timeline · Admin · Command Center · Debug · Audit · Invariant · UX Suite

**Infrastructure:** Export/Import · Custom Lens Builder · App Maker · Fork · Legacy · Bridge · Foundry

**Specialized Domains:** Lab · Experience · Simulation · Journalism · Translation · Archival · Military/Defense · Diplomacy · Space · Ocean · Desert · Urban Planning · Transportation · Telecommunications · Mining · Forestry · Veterinary · Law Enforcement · Emergency Services

**World Lens (Concordia):** 3D civilization simulator — districts, NPCs, multiplayer, creator economy, physics validation, user-created cities with configurable rulesets

-----

## Pan-Social Hub (`/lenses/social`)

A first-class social surface that sits alongside the 232 domain lenses. Every primitive is reusable — drop them into any lens to make any artifact discussable, share-able, reactable.

| Primitive | What it does |
|---|---|
| **ReactionBar** | 6 reaction types (`like`/`fire`/`heart`/`mind-blown`/`useful`/`disagree`) backed by `POST /api/social/react`. Optimistic UI; rolls back on failure. Counts are real — no synthetic warming. |
| **CommentThread** | Threaded replies with `parentCommentId`. Collapsed mode for inline mounts (every DTU embed). Real-time updates via Socket.io. |
| **QuickPostComposer** | Post / 24h Story modes with 500-char counter + tags. Wires through `createPost` with optional `isStory=true`. |
| **ShareButton** | Repost-with-commentary via `POST /api/social/share`. Hides when share count is 0 and the composer is closed. |
| **BookmarkButton** | Toggle save-for-later via `POST /api/social/bookmark` (single endpoint that flips on/off). Shared cache across the app. |
| **FollowButton** | `POST /api/social/follow` + `/unfollow`. Hides for self; hides for anonymous viewers. |
| **UserLink** | Username chip routing to `/profile/[username]`. Optional inline FollowButton mount. Falls back to plain span when neither username nor userId is present. |
| **DTUEmbed** | The canonical cross-lens DTU preview. Composes ReactionBar + ShareButton + BookmarkButton + CommentThread + DownstreamBadge + CreatorBadge + TierBadge + FederationBadge + FreshnessBadge so social context follows the DTU into every lens. |

The `/lenses/social` page mounts these primitives together as a Facebook/Instagram/Twitter-class hub: StoriesBar → Discover/Following/Notifications/Analytics tabs → CreatorAnalytics + SuggestedFollows + TrendingTopics + TrendingDomains rails. Every datum it shows is real substrate state — empty states say "nothing yet" instead of fake placeholders.

-----

## The Knowledge Substrate (DTUs)

DTUs are the atomic unit of knowledge in Concord. Everything the platform produces, stores, and trades is a DTU.

### Content Types

|Code  |Type               |Examples                                   |
|------|-------------------|-------------------------------------------|
|`0x01`|Audio              |Music, podcasts, voice notes, sound effects|
|`0x02`|Images             |Art, photography, designs, diagrams        |
|`0x03`|Video              |Films, tutorials, clips, streams           |
|`0x04`|Documents          |Articles, research, contracts, guides      |
|`0x05`|Code               |Scripts, functions, applications, snippets |
|`0x06`|Research           |Papers, studies, data analysis, hypotheses |
|`0x07`|Datasets           |CSV, JSON, tables, measurements            |
|`0x08`|3D Models          |CAD, game assets, architectural models     |
|`0x09`|Mixed              |Multiple content types in one container    |
|`0x0A`|Condensed Knowledge|MEGA/HYPER consolidations                  |
|`0x0B`|Culture Memory     |Traditions, practices, community knowledge |

### How They Work

Every DTU carries a self-verifying content hash + compressed content. Four internal layers: human-readable summary, structured core (definitions, invariants, claims), machine metadata (tags, embeddings, relationships), and an optional binary artifact stored at `./data/artifacts/{dtuId}/`.

DTUs consolidate over time:

```
Regular DTU (~5KB) → MEGA (5–20 originals) → HYPER (50–200 originals)
```

Consolidation runs automatically inline on the heartbeat every 30 ticks: regular DTUs cluster into MEGAs, then MEGAs cluster into HYPERs once MEGA population crosses the threshold. Lineage is always preserved — originals are archived, never hard-deleted (the user-initiated `dtu:deleted` path is the only hard-delete). Unconsolidatable low-salience DTUs get tombstoned, but their lineage remains.

There is **no hard DTU ceiling.** Memory pressure is governed by `server/lib/memory-pressure.js` against `MAX_OLD_SPACE_SIZE`. With the 32GB-heap deployment default, the substrate comfortably holds ~1.5M DTUs.

### Inverted Economics

Cost per user decreases as the substrate grows. More queries resolve via cache/retrieval (near-zero cost) instead of full LLM inference. The system tracks this shift in real-time.

-----

## Economy

### Creator Economy

- **95% creator share** on the DTU royalty-aware path (`/api/marketplace/purchaseWithRoyalties`: 95% creator pool / 5% platform) — hardcoded, immutable, governance-gated.
- Royalty cascades through citation chains — original creators always get paid, regardless of derivation depth. Capped at 30% of the sale price to ancestors, halving per generation, with a 0.0005 floor and a 50-deep cascade cap. The seller always keeps ≥64.54%.
- Citation requires consent — a cascade short-circuits unless the parent DTU is public, its creator allowed citation, or the caller holds a purchased license.
- Concord Coin via Stripe. Token-purchase fee 1.46%; economic-marketplace path is 4% marketplace fee / 70% creator / 20% royalty / 10% treasury.
- 48-hour withdrawal hold — only credits older than 48h are withdrawal-eligible (anti-refund-exploit gate).
- Merit credit scoring from real platform contribution. 0% loan system based on activity, not credit history.
- No ads. No data selling. No paid promotion. Code-enforced.

### Internal Resource Economy

Resource types circulate between entities: COMPUTE · ENERGY · ATTENTION · SOCIAL_CAPITAL · DATA · INNOVATION · INFLUENCE · MEMORY. UBI distribution, inflation tax, wealth caps.

> **Marketplace fee constants are constitutional invariants.** They cannot be changed without governance approval. See the "Key Invariants" section of `CLAUDE.md` for the full list and their exact source locations.

-----

## Concord Mesh

Seven transport layers for infrastructure-independent DTU transmission:

|Layer|Transport           |Range   |
|-----|--------------------|--------|
|1    |Internet (TCP/IP)   |Global  |
|2    |WiFi Direct         |~100m   |
|3    |Bluetooth / BLE     |~30m    |
|4    |LoRa / Mesh Radio   |~15km   |
|5    |RF / Ham Packet     |Variable|
|6    |Telephone / Landline|Global  |
|7    |NFC / Physical      |Contact |

DTUs are transport-agnostic. A transfer can begin over internet, continue over radio, and complete over Bluetooth. Every DTU self-verifies on arrival regardless of channel — no TLS handshake needed, the DTU verifies its own integrity via content hash. Relay nodes forward sealed packages without access to content.

A $30 LoRa module and a basic device running Concord gives a user anywhere on Earth access to the full platform. No ISP subscription. No data plan.

-----

## Security

**Concord Shield** — multi-tier security intelligence:

- ClamAV, YARA-X, Suricata+Snort, OpenVAS, Wazuh, Zeek
- Every detection becomes a DTU. Threat DTUs are tagged as pain memory — never pruned, never forgotten.
- Collective immunity: one detection protects all nodes within one heartbeat tick.
- Repair cortex: 100+ error patterns, health monitors, database-backed pattern learning and crystallization. Deterministic strategies run before any LLM invocation.

**Application Security:**

- Three-gate permission system on every API call (`authMiddleware` path allowlist → `runMacro` domain allowlist → Chicken2 safe-read paths).
- Input validation against XSS, SQL injection, prototype pollution, null bytes.
- Rate limiting at the API and Nginx layers.
- LLM security: prompt injection protection, response validation, local-first by default. NPC narrative secrets are structurally omitted from LLM prompts with a defense-in-depth canary scan.
- Sovereign quarantine for compromised entities.
- Full documentation: `SECURITY.md`.

-----

## Five-Brain Architecture

Not five copies of one model. Five different models at five different scales for five different cognitive functions. All five Ollama services run with `OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE=q8_0` to use the Blackwell tensor cores and halve KV-cache memory. `initFiveBrains()` probes all five on startup and auto-pulls models.

|Brain           |Default model                    |Port |Role                                                            |
|----------------|---------------------------------|-----|----------------------------------------------------------------|
|**Conscious**   |`concord-conscious:latest`       |11434|Chat, deep reasoning, council deliberation                      |
|**Subconscious**|`qwen2.5:7b-instruct-q4_K_M`     |11435|Autogen, dreams, evolution, synthesis, batch processing         |
|**Utility**     |`qwen2.5:3b`                     |11436|Lens interactions, entity actions, quick domain tasks (~65% of requests)|
|**Repair**      |`qwen2.5:0.5b`                   |11437|Error detection, auto-fix, runtime repair                       |
|**Vision**      |`qwen2.5vl:7b`   |11438|LLaVA — image understanding, food vision, document layout       |

Every model is overridable via env var (`BRAIN_CONSCIOUS_MODEL`, `BRAIN_VISION_URL`, etc.). `ctx.llm.chat()` routes to conscious and falls back to subconscious. ~800 brain-routed domain macros across 160+ domains. **Bring-your-own keys:** when a user supplies an external API key, `ctx.llm.chat()` routes that user's individual brain slots through the BYO key router instead of local Ollama (migration 170).

-----

## World Lens — Concordia

A 3D physics-validated civilization simulator built as one lens inside the platform. Buildings are DTUs, objects are DTUs — everything is real and persists.

Key directories:
- `concord-frontend/lib/world-lens/` — Three.js terrain, building, avatar, physics (Rapier3D collision is authoritative)
- `concord-frontend/lib/concordia/` — gait synthesis, FABRIK IK, secondary physics, combat logic
- `concord-frontend/components/world/` + `components/concordia/` — IsometricEngine, AvatarSystem3D, CombatHUD, GameJuice, HUD, skills, dialogue, quests
- `server/lib/npc-*.js` — NPC simulation: routines, economies, schemes, asymmetry (grudges/preoccupations/desires), legacies, mentorship
- `server/emergent/quest-engine.js` + `server/lib/oracle-brain.js` — quest chains + LLM dialogue
- `content/world/` — 9 authored worlds (concordia-hub, concord-link-frontier, crime, cyber, fantasy, lattice-crucible, sovereign-ruins, superhero, tunya), each with factions, NPCs, and lore
- `content/quests/` — authored quest chains (onboarding, main arc, faction quests, first-day arc)

**The 13-layer embodied substrate** (migrations 112–118) gives Concordia a body:
- **Layer 7** — per-world environmental signal grid (temperature, humidity, air quality, light, noise, pressure, structural stress) with TTL decay
- **Layer 7.5** — environment-coupled skills (frost magic stronger in the cold, fire weaker in storms), DBZ-style terrain stagger, building damage
- **Layer 8** — repair/pain coupling: a per-player somatic ledger that converts combat damage into endurance/strength XP and damage-resist buffs
- **Layer 9** — embodied dream cycle: one grounded dream DTU per offline player, stitched from their actual recent activity
- **Layer 10** — subconscious forward-sim: speculative predictions about quests, NPCs, factions, and the player's own arc
- **Layer 11** — faction emergent strategy: factions run a deterministic state machine over consolidate/expand/war/alliance/rebuild/isolation stances
- **Layer 12** — lattice orchestrator: wires drift detection, cross-domain synthesis, federation, and multi-mode reasoning onto the heartbeat
- **Layer 13** — NPC-initiated ambient conversations

Server-side combat is fully validated — `_validateCombatReach` and `_validateDamageCap` gate the attack route against live position and skill magnitude. Combat env amplification is applied strictly *after* the damage cap.

-----

## SDK & Clients

- **`sdk/`** — `@concord/sdk` (v0.1.0): the public SDK surface (DTU protocol, examples).
- **`concord-vscode/`**, **`concord-jetbrains/`**, **`concord-lsp/`** — IDE integrations and a language server.
- **`extension/`** — browser extension.
- **`concord-mobile/`** — React Native + Expo 52 native app (BLE, WiFi P2P, geolocation, NFC, SQLite local store, wallet/marketplace). Not a web wrapper. ~42K lines.

> The "12 `@concord` npm packages" described in older docs were consolidated. Most were dropped during the absorbed-libs audit (mock/duplicate code); the survivors (DTU protocol, test, moderation) were folded into `server/lib/` and the `sdk/`. See `audit/cartograph/ABSORBED_LIBS.md` for the disposition of each.

-----

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+
- Docker (recommended for full deployment)

### First-time setup

```bash
git clone https://github.com/your-org/concord-cognitive-engine.git
cd concord-cognitive-engine
./setup.sh        # installs deps, creates data dirs + .env, runs migrations
```

### Development

```bash
# Backend (server/)
cd server && npm install && npm run dev      # node --watch, hot reload

# Frontend (concord-frontend/, separate terminal)
cd concord-frontend && npm install && npm run dev
```

`npm install` in `server/` is mandatory before first run — the codebase hard-requires `better-sqlite3`, `express`, `jsonwebtoken`, `yaml`, and `uuid`.

### Production (Docker)

```bash
cp .env.example .env
# Set required values: JWT_SECRET (required in production), plus Ollama URLs
docker-compose up
```

`docker-compose.yml` launches 13 services: backend, frontend, nginx, certbot, prometheus, grafana, redis, qdrant, and five Ollama brain instances. Models auto-pull on first boot. See `DEPLOYMENT.md` and `docs/RUNPOD_DEPLOY.md` for hosted-GPU deployment.

-----

## Stack

**Backend:** Node.js 18+ (ESM), Express, better-sqlite3 (synchronous, in-process, no ORM), five Ollama instances, Socket.IO, ~2,400 HTTP route registrations

**Frontend:** Next.js 15.5, React 19, TypeScript 5.9 (strict), Zustand, TanStack Query, Tailwind CSS, Three.js + Rapier3D for the World Lens

**Mobile:** React Native 0.76 + Expo 52 with native mesh networking (BLE, NFC, LoRa bridge, peer manager, relay system)

**Database:** SQLite via better-sqlite3. 196 numbered, append-only migrations (latest `196_dtu_surface_log.js`). 459+ tables. Schema version tracked in the `schema_version` table.

**Infrastructure:** Docker Compose (13 services), Nginx, Prometheus + Grafana, Kubernetes configs

**Hardware target:** RunPod RTX PRO 4500 Blackwell — 32GB GDDR7, 5th-gen tensor cores

-----

## Project Structure

```
concord-cognitive-engine/
├── server/
│   ├── server.js              # 70K+ lines — all routes, middleware, startup, tick logic (intentionally monolithic)
│   ├── dtus.js                # 145K+ lines — DTU substrate
│   ├── emergent/              # 178 modules (94K+ LOC) — the autonomous substrate
│   ├── domains/               # 249 domain backends — macro handlers
│   ├── routes/                # 131 route files (~1,300 routes)
│   ├── migrations/            # 192 numbered, append-only
│   ├── economy/               # royalty cascade, withdrawals, DTU pipeline
│   ├── lib/                   # 341 top-level / 561 recursive — shield, mesh, embodied substrate, npc-*, etc.
│   ├── grc/                   # Governance, Risk, Compliance
│   └── tests/, tests/         # ~163K LOC test code
├── concord-frontend/
│   ├── app/lenses/            # 232 lens pages
│   ├── components/            # 97 directories
│   ├── hooks/                 # 36 custom hooks
│   ├── lib/world-lens/        # Three.js + Rapier3D
│   └── store/                 # Zustand
├── concord-mobile/            # React Native + Expo 52 (~42K LOC)
├── concord-vscode/            # VS Code extension
├── concord-jetbrains/         # JetBrains plugin
├── concord-lsp/               # Language server
├── extension/                 # Browser extension
├── sdk/                       # @concord/sdk
├── content/                   # Authored worlds, quests, dialogues, foundry templates
├── audit/cartograph/          # Auto-generated systems inventory (npm run cartograph:static)
├── audit/detectors/           # Auto-generated detector reports (npm run detectors:report)
├── docs/                      # AUDIT_INVENTORY.md (source of truth), deployment, ops, audits
├── k8s/                       # Kubernetes configs
├── monitoring/                # Prometheus + Grafana
├── nginx/                     # Reverse proxy
└── docker-compose.yml
```

The server is **intentionally monolithic** — `server.js` holds all routes, middleware, startup, and the heartbeat tick logic (the in-code comment cites IP protection). Adding new routes means adding them directly to this file; it imports from `server/lib/`, `server/emergent/`, `server/domains/`, and `server/routes/`.

-----

## How It Runs — The Heartbeat

`governorTick()` drives all emergent simulation on a 15-second tick. Two registration patterns coexist:

- **Per-entity inline ticks** — modules in `server/emergent/` running at varying frequencies (every tick, every 5th, every 20th, etc.).
- **Singleton periodic modules** — registered via `registerHeartbeat(name, { frequency, handler })`. **64 unique heartbeats** are registered, from `refusal-field-sweep` (every tick) through `player-signs-cleanup` (every 240 ticks ≈ 1h).

The counter `concord_heartbeat_ticks_total` increments per tick; a rate of 0 for >60s means the loop has frozen (alert `ConcordHeartbeatStopped`). Overrun is observable via `concord_heartbeat_skipped_total`. Heartbeat modules must never throw — every handler is wrapped in `try/catch`.

-----

## Ethos

Invariants. Hardcoded. Cannot be overridden by configuration, governance, or any process.

- **LOCAL_FIRST_DEFAULT** — No cloud by default
- **NO_TELEMETRY** — Never phones home
- **NO_ADS** — No advertising, ever
- **NO_SECRET_MONITORING** — No hidden tracking
- **NO_USER_PROFILING** — No behavioral profiling
- **CLOUD_LLM_OPT_IN_ONLY** — Explicit consent required (BYO keys are per-user, opt-in)
- **PERSONA_SOVEREIGNTY** — Users own their personas
- **95% CREATOR SHARE** — Immutable
- **NO_FAVORITISM** — Code-enforced meritocracy
- **NO_DATA_SELLING** — User data belongs to user as DTUs
- **EXPORT_FREEDOM** — All content exportable, zero lock-in

-----

## Scale

All figures verified by direct `grep`/`ls` against the working tree. Reproduction commands live in `docs/AUDIT_INVENTORY.md`.

|Metric                  |Value                       |
|------------------------|----------------------------|
|Authored source LOC     |~2.05M (2.91M incl. content) — `npm run count-loc`|
|Source files            |~7,123                      |
|Frontend lens pages     |259 directories             |
|Backend domain files    |352                         |
|DTU substrate (`dtus.js`)|145,612 lines (deprecated data seed pack — NOT code)|
|Server core (`server.js`)|76,239 lines               |
|Emergent modules        |214 files                   |
|Lib modules             |565 top-level / 858 recursive|
|Route files             |131                         |
|HTTP route registrations|~3,353 (1,397 in server.js + 1,956 in routes/*.js)|
|Macros                  |~9,623 (domain, macro) pairs across ~478 domains|
|Migrations              |329 numbered (latest `330_agent_drift_watch.js`)|
|Database tables         |459                         |
|Heartbeats              |64 registered               |
|Mobile client           |~42,000 lines               |
|Test code               |~163,000 lines              |
|Authored worlds         |9                           |
|Heartbeat interval      |15 seconds                  |
|Consolidation ratio     |~33:1                       |
|DTU in-heap capacity    |~1.5M (32GB heap default)   |

-----

## License

**CONCORD SOURCE LICENSE — COMMUNITY EDITION (CSL-CE 1.0)**

Free for personal, educational, and research use. Self-hosted nodes permitted. Contributions welcome. Commercial use, hosted services, derivative marketplaces, and competing networks require written permission from the project owner. See `LICENSE.txt` for full terms.

-----

Built with sovereignty in mind. Your thoughts, your rules.
