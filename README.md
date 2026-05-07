# Concord Cognitive Engine

**A cognitive operating system.**

175 domain lenses. Four parallel AI brains. A self-compressing knowledge substrate. A creator economy with perpetual royalties. A seven-layer mesh network that works without internet. A 3D civilization simulator. Constitutional governance enforced in code. Security intelligence with collective immunity.

**1.3 million+ lines of code. One developer. First project.**

**Live at [concord-os.org](https://concord-os.org)**

-----

## What This Is

Concord is a platform where every domain of human knowledge — from physics to plumbing, finance to film production, materials science to music — lives inside a unified substrate. Each domain has its own full-featured interface (a “lens”), its own AI pipeline routed to the right brain for the job, and its own economy where creators earn 95% of every transaction with perpetual royalty attribution.

The knowledge substrate isn’t a database. It compresses as it grows — individual knowledge units consolidate into larger structures at a 33:1 ratio, preserving lineage while reducing cost. The more people use it, the cheaper it gets to run.

The platform runs on four parallel LLMs with distinct cognitive roles, a mesh network that can transmit knowledge over radio, Bluetooth, or telephone if the internet goes down, and a security system where one threat detection protects every node on the network within 15 seconds.

-----

## Core Architecture

|Layer                             |What It Does                                                                                                                                                                                               |
|----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**175-Lens Interface**            |175 domain-specific cognitive applications — each with its own UI, API routes, AI actions (Analyze/Generate/Suggest), and economy connection. Not templates. First-party tools backed by the full substrate|
|**Five-Brain Cognition**          |Five parallel Ollama LLM instances tuned for RTX PRO 4500 Blackwell — Conscious (qwen2.5:32b), Subconscious (qwen2.5:7b), Utility (qwen2.5:3b), Repair (qwen2.5:1.5b), Vision (llava:13b-v1.6) — with distinct roles and 450+ brain-routed domain actions. Conscious → OpenAI emergency fallback if Ollama is offline.                                        |
|**DTU Substrate**                 |Discrete Thought Units — the atomic knowledge format. 11 content types, three internal layers (human/core/machine), MEGA/HYPER consolidation at 33:1 compression, 48-byte self-verifying headers           |
|**Creator Economy + Concord Coin**|95% creator share (hardcoded, immutable). Royalty cascades through citation chains. Merit credit. 0% loans. Concord Coin at 2.92% combined transaction rate. Stripe integration                            |
|**Concord Mesh**                  |Seven transport layers (Internet, WiFi Direct, BLE, LoRa, RF/Ham, Telephone, NFC). DTUs are transport-agnostic — start a transfer over internet, finish over radio                                         |
|**Concord Shield**                |Six-tier security intelligence (ClamAV, YARA-X, Suricata+Snort, OpenVAS, Wazuh, Zeek). Collective immunity — one detection protects all nodes in one heartbeat tick. Pain memory never prunes threats      |
|**Constitutional Governance**     |Three-tier rules (immutable/constitutional/policy). Council voting. Anti-gaming detection. Lattice READ/PROPOSE/COMMIT pipeline. Every action audited                                                      |
|**World Lens (Concordia)**        |3D physics-validated civilization simulator. Procedural NPCs. Creator economy. Multiplayer. User-created cities. 28 simulation domains. 55 React components                                                |
|**Autonomous Substrate**          |88 emergent entities with biological lifecycle, 166-organ bodies, sleep/dream cycles, reproduction, cultural emergence, and knowledge generation — the system creates new knowledge without human input    |
|**LOAF Framework**                |Long-horizon Oversight and Action Framework — civilization-scale simulation, policy rehearsal, 10 tiers across 35 modules                                                                                  |
|**Existential OS**                |26 qualia operating systems across 6 tiers — continuous experiential state layer                                                                                                                           |
|**Mind Space**                    |Consciousness-to-consciousness communication protocol, software-complete, designed for BCI upgrade                                                                                                         |

-----

## The 175 Lenses

Every lens is a standalone domain application with its own route, UI, real-time data, AI actions routed to the correct brain, and full economy integration. Each lens reads/writes to the shared DTU substrate, participates in cross-lens commerce (tipping, bounties, royalty cascades), passes 12-phase compliance validation, and can be forked and governed independently.

**Knowledge & Research:** Research · Hypothesis · Reasoning · Metacognition · Graph · Education · Science · Philosophy · History · Mathematics · Linguistics

**Creative & Media:** Art · Music · Creative Writing · Studio · Film Studios · Artistry · Whiteboard · Game Design · Photography · Animation · Poetry

**Healthcare & Wellness:** Healthcare · Mental Health · Fitness · Nutrition/Food · Bio · Chem · Suffering · Pharmacy

**Engineering & Science:** Code · Database · Engineering · Materials Science · Physics · Astronomy · Geology · Environmental · Energy · Robotics

**Professional & Business:** Finance · Legal · Accounting · Real Estate · Marketing · HR · Consulting · Insurance · Supply Chain · Projects

**Trades & Construction:** Construction · Plumbing · Electrical · HVAC · Welding · Carpentry · Masonry · Automotive · Agriculture · Landscaping

**Lifestyle:** Travel · Fashion · Cooking · Home · Parenting · Pets · Sports · DIY

**Social & Community:** Feed · Forum · Marketplace · Collab · Vote · Global · Alliance · Debate · Mentorship

**System & Governance:** Chat · Entity · Council · Organ · Tick · Timeline · Admin · Command Center · Debug · Audit · Invariant

**Infrastructure:** Export/Import · Custom Lens Builder · App Maker · Fork · Legacy · Bridge

**Specialized Domains:** Lab · Experience · Simulation · Journalism · Translation · Archival · Military/Defense · Diplomacy · Space · Ocean · Desert · Urban Planning · Transportation · Telecommunications · Mining · Forestry · Veterinary · Law Enforcement · Emergency Services

**World Lens (Concordia):** 3D civilization simulator — districts, NPCs, multiplayer, creator economy, physics validation, user-created cities with configurable rulesets

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

Every DTU carries a 48-byte self-verifying header + compressed content. Four internal layers: human-readable summary, structured core (definitions, invariants, claims), machine metadata (tags, embeddings, relationships), and optional binary artifact.

DTUs consolidate over time:

```
Regular DTU (~5KB) → MEGA (5–20 originals) → HYPER (50–200 originals)
```

Lineage is always preserved. Originals are archived, never deleted. Unconsolidatable low-salience DTUs get tombstoned but their lineage remains. Memory ceiling: ~170,000 DTUs in-heap (1.3GB). Compression ratio: ~33:1.

### Inverted Economics

Cost per user decreases as the substrate grows. More queries resolve via cache/retrieval (near-zero cost) instead of full LLM inference. The system tracks this shift in real-time.

-----

## Economy

### Creator Economy

- **95% creator share** — hardcoded, immutable, non-negotiable
- Royalty cascades through citation chains — original creators always get paid, regardless of derivation depth
- Concord Coin at 2.92% combined rate (4% marketplace + 1.46% Lane C)
- 20 marketplace content types
- Merit credit scoring from real platform contribution
- 0% loan system based on activity, not credit history
- License tiers per content type
- Commission system with escrow
- No ads. No data selling. No paid promotion. Code-enforced.

### Platform Economy

- Stripe integration for real payments
- Fee tracking and withdrawal processing
- Treasury reconciliation

### Internal Resource Economy

Eight resource types circulate between entities: COMPUTE · ENERGY · ATTENTION · SOCIAL_CAPITAL · DATA · INNOVATION · INFLUENCE · MEMORY. UBI distribution, inflation tax at 20% supply growth, wealth cap at 15% of total supply.

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

DTUs are transport-agnostic. A transfer can begin over internet, continue over radio, and complete over Bluetooth. Every DTU self-verifies on arrival regardless of channel. Relay nodes forward sealed packages without access to content. No TLS handshake needed — the DTU verifies its own integrity via content hash.

A $30 LoRa module and a basic device running Concord gives a user anywhere on Earth access to the full platform. No ISP subscription. No data plan. Just a radio module and the lattice.

-----

## Security

**Concord Shield** — six-tier security intelligence:

- ClamAV, YARA-X, Suricata+Snort, OpenVAS, Wazuh, Zeek
- Every detection becomes a DTU. Threat DTUs are tagged as pain memory — never pruned, never forgotten
- Collective immunity: one detection protects all nodes within one heartbeat tick
- Repair cortex: 4,600+ lines, 100+ error patterns, 16 health monitors, database-backed pattern learning and crystallization

**Application Security:**

- Three-gate permission system on every API call
- Input validation against XSS, SQL injection, prototype pollution, null bytes
- Rate limiting at API (100/min) and Nginx (10-30/sec) layers
- LLM security: prompt injection protection, response validation, local-first by default
- Sovereign quarantine for compromised entities
- Full documentation: SECURITY.md

-----

## Four-Brain Architecture

Not four copies of one model. Four different models at four different scales for four different cognitive functions.

|Brain           |Model                                                   |Role                                                                                                       |
|----------------|--------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
|**Conscious**   |qwen2.5:14b-instruct-q4_K_M + `concord-conscious:latest`|Deep reasoning, council deliberation, interactive discussion                                               |
|**Subconscious**|qwen2.5:7b-instruct-q4_K_M                              |Autogen, dreams, evolution, synthesis, batch processing                                                    |
|**Utility**     |qwen2.5:3b                                              |Lens interactions, quick tasks, domain actions (handles 65% of all lens requests)                          |
|**Repair**      |qwen2.5:0.5b                                            |Continuous error detection, auto-fix, security triage. 8 deterministic strategies run before LLM invocation|

450+ domain-specific actions routed across all four brains. The conscious brain runs through the GRC (Governance, Risk, Compliance) pipeline with a custom identity system prompt.

-----

## World Lens — Concordia

A 3D physics-validated civilization simulator built as one lens inside the platform. 55 React components, 28 interconnected simulation domains, 27,215 lines of code.

- Buildings are DTUs. Deleting a building deletes the MEGA. Creating an object creates a DTU. Everything is real.
- Materials validated against real physics and IBC building codes
- Procedural NPCs with LLM-powered dialogue and event memory
- Creator economy — architects earn royalties on validated structures
- User-created cities with configurable rulesets (RP, building, exploration, economy-focused)
- Multiplayer with factions, organizations, mentorship, social gathering spaces
- Districts mapped to lens domains — the Music district plays audio DTUs, the Code district runs terminals
- Every lens in the platform is accessible as a workstation inside the world

-----

## Infrastructure Packages

12 `@concord` npm packages:

|Package              |Purpose                        |
|---------------------|-------------------------------|
|`@concord/cpm`       |Package Manager                |
|`@concord/validate`  |Validation Engine as a Service |
|`@concord/protocol`  |DTU Protocol Specification     |
|`@concord/brain`     |Brain-as-a-Service             |
|`@concord/identity`  |Identity System                |
|`@concord/sync`      |Sync Engine                    |
|`@concord/procgen`   |Procedural Generation Framework|
|`@concord/components`|Component Registry             |
|`@concord/observe`   |Observability SDK              |
|`@concord/test`      |Testing Framework              |
|`@concord/moderate`  |Moderation Pipeline            |
|`@concord/lens`      |Lens Creation Framework        |

-----

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+
- Docker (recommended for full deployment)

### Development

```bash
git clone https://github.com/your-org/concord-cognitive-engine.git
cd concord-cognitive-engine

# Backend
cd server && npm install && npm run dev

# Frontend (separate terminal)
cd concord-frontend && npm install && npm run dev
```

### Production (Docker)

```bash
cp .env.example .env
# Set required values: JWT_SECRET, ADMIN_PASSWORD, SESSION_SECRET
docker-compose up
```

Launches 6 containers: backend, frontend, and four Ollama brain instances. Auto-pulls models on first boot.

-----

## Stack

# Brain models (defaults work, but configurable)
BRAIN_CONSCIOUS_MODEL=qwen2.5:14b-q4_K_M
BRAIN_SUBCONSCIOUS_MODEL=qwen2.5:7b
BRAIN_UTILITY_MODEL=qwen2.5:3b
BRAIN_REPAIR_MODEL=qwen2.5:1.5b

**Mobile:** React Native with native mesh networking (BLE, NFC, LoRa bridge, peer manager, relay system) — 40K+ lines

**Extension:** Browser extension

**Infrastructure:** Docker Compose (6 containers), Nginx, Prometheus + Grafana, Kubernetes configs

**Hardware:** RunPod RTX PRO 4500 Blackwell — 32GB VRAM, 128 cores, 62GB RAM

-----

## Project Structure

```
concord-cognitive-engine/
├── server/
│   ├── server.js              # 54K+ lines
│   ├── dtus.js                # 145K+ lines
│   ├── emergent/              # 120+ modules (81K+ LOC)
│   ├── economy/               # 34 files (16K+ LOC)
│   ├── loaf/                  # 35 files (16K+ LOC)
│   ├── existential/           # 26 OS, 6 tiers
│   ├── mind-space/            # 4 modules
│   ├── domains/               # 24 domain backends
│   ├── lib/                   # 39K+ LOC (shield, mesh, qualia bridge, etc.)
│   ├── grc/                   # Governance, Risk, Compliance
│   └── tests/                 # 109K+ LOC
├── concord-frontend/
│   ├── app/lenses/            # 175 lens pages (226K+ LOC)
│   ├── components/            # 69+ directories
│   ├── hooks/                 # 30+ custom hooks
│   └── store/                 # Zustand
├── concord-mobile/            # React Native (40K+ LOC)
├── extension/                 # Browser extension
├── packages/                  # 12 @concord npm packages
├── k8s/                       # Kubernetes configs
├── monitoring/                # Prometheus + Grafana
├── nginx/                     # Reverse proxy
└── docker-compose.yml
```

-----

## Ethos

Invariants. Hardcoded. Cannot be overridden by configuration, governance, or any process.

- **LOCAL_FIRST_DEFAULT** — No cloud by default
- **NO_TELEMETRY** — Never phones home
- **NO_ADS** — No advertising, ever
- **NO_SECRET_MONITORING** — No hidden tracking
- **NO_USER_PROFILING** — No behavioral profiling
- **CLOUD_LLM_OPT_IN_ONLY** — Explicit consent required
- **PERSONA_SOVEREIGNTY** — Users own their personas
- **95% CREATOR SHARE** — Immutable
- **NO_FAVORITISM** — Code-enforced meritocracy
- **NO_DATA_SELLING** — User data belongs to user as DTUs
- **EXPORT_FREEDOM** — All content exportable, zero lock-in

-----

## Scale

|Metric              |Value                 |
|--------------------|----------------------|
|Total lines of code |1,300,000+            |
|Source files        |1,392+                |
|Frontend lens pages |175 routes (226K+ LOC)|
|DTU substrate       |145,000+ lines        |
|Server core         |54,000+ lines         |
|Emergent modules    |120+ files (81K+ LOC) |
|Mobile client       |40,000+ lines         |
|Test code           |109,000+ lines        |
|API routes          |948+                  |
|Domain actions      |450+ (brain-routed)   |
|npm packages        |12                    |
|Cognitive engines   |15                    |
|LOAF tiers          |10 (35 modules)       |
|Qualia systems      |26 (6 tiers)          |
|Active entities     |88                    |
|DTU in-heap capacity|~170,000              |
|Heartbeat interval  |15 seconds            |
|Consolidation ratio |~33:1                 |
|Architecture audit  |9/10                  |
|Build errors        |0                     |
|TypeScript errors   |0                     |
|Unused variables    |0                     |

-----

## License

**CONCORD SOURCE LICENSE — COMMUNITY EDITION (CSL-CE 1.0)**

Free for personal, educational, and research use. Self-hosted nodes permitted. Contributions welcome. Commercial use, hosted services, derivative marketplaces, and competing networks require written permission from the project owner. See LICENSE.txt for full terms.

-----

Built with sovereignty in mind. Your thoughts, your rules.