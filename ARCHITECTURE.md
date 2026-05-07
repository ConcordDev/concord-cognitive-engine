# Concord Cognitive Engine — Architecture

## Five-Brain Architecture (4 cognitive + 1 multimodal/vision)

Concord runs five Ollama instances tuned for the **NVIDIA RTX PRO 4500 Blackwell** (32GB GDDR7, 5th-gen tensor cores). Override any model via env var.

| Brain | Default model (q4_K_M) | VRAM | Port | Role |
|-------|---|---|---|---|
| Conscious | `qwen2.5:32b-instruct-q4_K_M` | ~18GB | 11434 | Chat, deep reasoning, council deliberation |
| Subconscious | `qwen2.5:7b-instruct-q5_K_M` | ~5GB | 11435 | Autogen, dream, evolution, synthesis, birth |
| Utility | `qwen2.5:3b-instruct-q5_K_M` | ~2GB | 11436 | Lens interactions, entity actions, quick tasks (~65% of requests) |
| Repair | `qwen2.5:1.5b-instruct-q5_K_M` | ~1GB | 11437 | Error detection, auto-fix, runtime repair |
| Vision (multimodal) | `llava:13b-v1.6-vicuna-q4_K_M` | ~9GB | 11438 | Image understanding, food vision, doc layout |

`ctx.llm.chat()` routes to the conscious brain via Ollama. If conscious fails, subconscious brain serves as emergency fallback.
`initThreeBrains()` probes each brain on startup and auto-pulls models if missing.

## DTU Lifecycle

```
Created (regular DTU, ~5KB in heap)
  → Lives in heap, gets accessed, cited, activated
  → Cluster detection finds it belongs to a group

Absorbed into MEGA (~5KB freed, MEGA grows ~2-3KB)
  → Archived to disk, removed from heap
  → Lineage preserved, rehydratable on demand

MEGA lives in heap (~15KB, representing 5-20 originals)
  → Cluster detection finds related MEGAs

Absorbed into HYPER (~15KB freed, HYPER grows ~5-10KB)

HYPER lives in heap (~30KB, representing 50-200 originals)
  → Long-term persistent knowledge layer

Forgetting (unconsolidatable DTUs only)
  → Low-salience DTUs that no cluster wants
  → Converted to tombstones, never truly deleted
```

### Consolidation Constants (Hardware-Derived)

- Memory ceiling: ~170,000 DTUs in-heap (1.3GB available)
- Consolidation runs every 30 ticks (~7.5 minutes)
- MEGA: 5-20 regular DTUs → 1 consolidated MEGA
- HYPER: 3-10 MEGAs → 1 meta-consolidated HYPER
- Effective compression ratio: ~33:1 (regular → HYPER)
- Forgetting engine only handles unconsolidatable noise

## Entity Lifecycle

```
Birth (createNewbornEntity)
  → Body instantiation (166 organs, all at maturity 0)
  → Species classification
  → Economy account initialization

Growth (heartbeat ticks)
  → decideBehavior: entity chooses what to do
  → processExperience: organ maturity increases
  → ageEntity: telomere shortens
  → Sleep/wake cycle: fatigue accumulates, sleep consolidates

Reproduction (when mature enough)
  → Two compatible parents
  → Offspring inherits trait mix + mutations
  → New body instantiated

Death (when death conditions met)
  → Telomere depleted, homeostasis collapse, or sovereign decree
  → Memorial DTU created
  → Knowledge preserved via consolidation
```

### Entity Limits (Hardware-Derived)

- Max active entities: 200 (hard cap)
- Target active entities: 100 (optimal for 8 vCPU)
- LLM inferences per hour: 400 (subconscious brain capacity)
- Budget: 2 inferences per entity per hour

## Three-Gate Permission System

Every frontend API call passes through three gates in `server.js`:

1. **Gate 1 (authMiddleware)**: `publicReadPaths` array — path prefix allowlist for unauthenticated GET requests
2. **Gate 2 (runMacro)**: `publicReadDomains` object — domain+macro name allowlist
3. **Gate 3 (Chicken2)**: `_safeReadPaths` array + `safeReadBypass` boolean — bypass for the lattice reality guard

All three gates must allow a request for it to succeed without authentication.
POST endpoints require JWT/cookie auth but bypass the public read gates.

## Heartbeat Tick

The governor heartbeat fires every 15 seconds (configurable). Each tick:

1. **Pipeline macros** (when enabled): autogen, dream, evolution, synthesis
2. **Queue processing**: jobs, queue, ingest, crawl
3. **Goal heartbeat** + agent scheduler
4. **Emergent system ticks** (see WIRING_SPEC.md for full list):
   - Biological: body decay, sleep, death, emotions, drift, time, wounds
   - Economy: UBI distribution (10th), health checks (100th)
   - Growth: decideBehavior, aging, experience processing
   - Cognitive: teaching (20th), attention, evidence (15th), purpose
   - Culture: tradition emergence, adherence
   - Consolidation: MEGA/HYPER formation (30th)
   - Forgetting: prune low-salience DTUs (50th)
   - Security: threat surface scan (30th)
   - Meta: breakthrough clusters (100th), meta-derivation (200th)
   - Self-healing: dream review when idle (20th)
5. **Kernel metrics tick**: homeostasis, organ wear

## Economy

### Platform Economy
- Stripe integration for subscriptions
- Fee tracking by type
- Withdrawal processing

### Entity Economy (Five Resource Types)
- COMPUTE, ENERGY, ATTENTION, SOCIAL_CAPITAL, DATA, INNOVATION, INFLUENCE, MEMORY
- UBI: +1 COMPUTE per entity every 10 ticks
- Income from contributions (DTU promotion, teaching, research)
- Sinks: web exploration, deep reasoning, publishing, reproduction
- Inflation tax at 20% supply growth
- Wealth cap at 15% of total supply

## Culture Layer

Emergent cultural traditions arise from repeated entity behaviors:
- Types: PRACTICE, RITUAL, CUSTOM, IDIOM, TABOO
- Status lifecycle: emerging → established → fading → extinct
- Adherence tracking per entity
- Cultural stories and retellings
- `cultureTick()` runs every heartbeat

## Artifact System (v2.1)

DTUs have a fourth optional layer — `artifact` — for binary data:

```
DTU {
  human: { summary, bullets }       // Human-readable
  core:  { claims, definitions }     // Structured knowledge
  machine: { kind, verifier }        // Machine metadata
  artifact: { type, size, path, ... } // Binary reference (~200B in heap)
}
```

### Storage
- Binary files stored on disk at `./data/artifacts/{dtuId}/{filename}`
- 280GB disk budget, auto-cleanup when >90% full
- Supported: audio, image, video, PDF, documents, code archives
- Features: compression detection, thumbnail generation, waveform extraction, text preview

### API Endpoints
- `POST /api/artifact/upload` — multipart upload, creates artifact DTU
- `GET /api/artifact/:dtuId/stream` — range-request streaming (audio/video seeking)
- `GET /api/artifact/:dtuId/download` — full file download
- `GET /api/artifact/:dtuId/info` — metadata without binary
- `GET /api/artifact/:dtuId/thumbnail` — generated preview image

### Constants (ARTIFACT)
- MAX_ARTIFACT_SIZE: 100MB
- DISK_USAGE_WARNING: 70%, DISK_USAGE_CRITICAL: 90%
- AVAILABLE_DISK_BYTES: 280GB

## Feedback Engine (v2.1)

User feedback creates DTUs that drive evolution proposals:

```
User submits feedback → feedback DTU created → aggregated by target
  → If enough feature requests → evolution proposal DTU
  → If enough bug reports → repair proposal
  → If negative sentiment → council review flag
  → DTU authority scores adjusted by feedback
```

### Processing
- Feedback queue processed periodically in heartbeat (FEEDBACK.PROCESS_INTERVAL ticks)
- Thresholds: 3 requests → proposal, 2 reports → repair, -5 sentiment → council
- Authority adjustment rate: 0.01 per sentiment point

## Marketplace (v2.0)

DTUs can be listed and purchased on the marketplace:

### Content Types (20)
dtu_pack, recipe, workout_program, music_composition, artwork, creative_writing,
course, template, code_module, game_world, simulation, style_theme, workflow,
lens_app, entity_personality, whiteboard, dataset, video, document, binary_artifact

### Macros
- `marketplace.browse` — paginated listing with category/search/sort filters
- `marketplace.list` — create a listing (scope-validated)
- `marketplace.purchase` — buy a listing, transfer ownership
- `marketplace.dtu_browse` — browse DTU-backed marketplace items

## Sovereign Audit (v3.0)

Three audit endpoints for the sovereign dashboard:

- `GET /api/sovereign/audit/heartbeat` — tick timing, module failures, stalled entities
- `GET /api/sovereign/audit/dtu-lifecycle` — tier distribution, consolidation health, archive stats
- `GET /api/sovereign/audit/gates` — three-gate configuration dump for permission verification

All sovereign endpoints protected by SOVEREIGN_ROUTES check (requires sovereign role).

## Rate Limiting

Expensive macros are rate-limited to prevent abuse:

```javascript
EXPENSIVE_MACROS: {
  "system.synthesize": 2/min,
  "system.analogize": 2/min,
  "system.consolidate": 1/min,
  "context.query": 10/min,
  "marketplace.purchase": 5/min,
  "emergent.bridge.heartbeatTick": 1/min,
}
```

## Repair Cortex

The repair brain (0.5B) runs a continuous loop:
- Detects runtime errors and pattern violations
- Generates fix proposals
- Applies safe patches with rollback capability
- Tracks fix success rate
