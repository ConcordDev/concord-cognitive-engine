# Emergent Module Dependency Graph

> Auto-documented architecture map of the 178 emergent modules, their dependencies,
> data flows, and heartbeat timing.

## Module Layers

```
LAYER A: Probabilistic Dialogue Engine (exploration)
    dialogue.js -> gates.js, store.js, subjective-time.js
    controller.js -> dialogue.js, growth.js, store.js
    council-voices.js (standalone)

LAYER B: Deterministic Validation Gates (constraint)
    gates.js -> schema.js
    empirical-gates.js (standalone)
    schema-guard.js (standalone)
    injection-defense.js (standalone)
    content-shield.js (standalone)

LAYER C: Governance / Promotion (becoming real)
    governance.js -> schema.js, store.js
    growth.js -> schema.js, store.js, context-engine.js, subjective-time.js, trust-network.js
    reality.js -> store.js, edges.js, purpose-tracking.js, subjective-time.js
    promotion-pipeline.js -> store.js

LATTICE INFRASTRUCTURE:
    lattice-ops.js -> store.js
    edges.js -> schema.js
    merge.js (standalone)
    journal.js -> store.js
    activation.js -> store.js

CONTEXT & KNOWLEDGE:
    context-engine.js -> edges.js, store.js, scope-separation.js, districts.js
    shadow-graph.js (standalone)
    autogen-pipeline.js -> empirical-gates.js, council-voices.js
    meta-derivation.js -> store.js, edges.js, purpose-tracking.js, subjective-time.js
    dream-capture.js -> STATE.dtus (direct)
    forgetting-engine.js -> STATE.dtus (direct)

COGNITIVE GEOGRAPHY:
    scope-separation.js -> store.js
    districts.js (standalone)
    sectors.js (standalone)

ATLAS (v5.5):
    atlas-heartbeat.js -> atlas-config.js, atlas-epistemic.js, atlas-store.js,
                          atlas-antigaming.js, atlas-scope-router.js, atlas-write-guard.js

BIOLOGICAL SYSTEMS:
    body-instantiation.js (standalone per-entity)
    sleep-consolidation.js (standalone per-entity)
    relational-emotion.js (standalone per-entity)
    avoidance-learning.js (standalone per-entity)
    death-protocol.js (standalone per-entity)
    subjective-time.js -> store.js

MEMORY & TRUST:
    trust-network.js -> store.js
    institutional-memory.js -> store.js
    evidence.js (standalone)
    purpose-tracking.js -> store.js

COMMUNICATION:
    emergent-comms.js -> store.js
    want-engine (server/prompts/) -> STATE

SELF-REPAIR:
    repair-cortex.js (Organ 169) -> STATE (direct)
    capability-bridge.js -> empirical-gates.js

PERSISTENCE:
    persistence.js -> store.js
    state-migration.js -> store.js
```

## Central Hub: `store.js`

48 modules depend on `store.js`. It maintains:

| Registry          | Purpose                        |
|-------------------|--------------------------------|
| emergents         | Entity registry                |
| sessions          | Dialogue sessions              |
| outputBundles     | Bundled governance outputs     |
| gateTraces        | Gate execution audit trail     |
| patterns          | Learned behavioral patterns    |
| reputations       | Credibility vectors            |

## STATE Property Access Matrix

| Module                 | Reads STATE          | Writes STATE          |
|------------------------|---------------------|-----------------------|
| dialogue.js            | sessions            | sessions              |
| growth.js              | dtus                | patterns, reputations |
| governance.js          | dtus                | via macro system      |
| context-engine.js      | dtus, edges         | user profiles         |
| dream-capture.js       | dtus                | dtus, meta queue      |
| forgetting-engine.js   | dtus                | dtus (tombstones)     |
| meta-derivation.js     | dtus                | dtus (meta-DTUs)      |
| scope-separation.js    | dtus, settings      | dtus (scope tags)     |
| autogen-pipeline.js    | dtus                | proposals             |
| repair-cortex.js       | dtus, organs        | dtus, organs          |
| body-instantiation.js  | --                  | entity state          |
| sleep-consolidation.js | --                  | entity state          |
| avoidance-learning.js  | --                  | entity wounds         |
| death-protocol.js      | --                  | entity lifecycle      |

## Heartbeat Timing

```
Every tick (10-15s):
  |-- Cognitive worker (autogen, dream, evolution, synthesize)
  |-- Ingest queue processing
  |-- Capability bridge tick
  |-- Repair agent tick (Organ 169)
  |-- Analogize (1s delayed)
  |-- For each active entity:
  |     |-- Body decay
  |     |-- Sleep transition
  |     |-- Subjective time
  |     |-- Emotion decay
  |     |-- Wound healing
  |     |-- Death condition check
  |-- Plugin tick hook

Every 5th tick (~50s):
  |-- Drift scan

Every 120th tick (~30 min):
  |-- Spontaneous message trigger

Every 240th tick (~1 hour):
  |-- Want engine decay

Every 480th tick (~2 hours):
  |-- Probation audit

Every 5760th tick (~24 hours):
  |-- Dedup audit

Every 172800th tick (~30 days):
  |-- Substrate pruning

Independent schedule (every 5 min):
  |-- Global scope tick:
       |-- Score recomputation (max 50 DTUs)
       |-- Contradiction consistency
       |-- Dedupe candidates (max 20 DTUs)
```

## Key Data Flows

### Dream -> Meta-Derivation
```
dream-capture.captureDream()
  -> convergence check against existing DTUs
  -> STATE._metaDerivationQueue
  -> meta-derivation.ingestDreamInput()
  -> runConvergenceCheck()
  -> if converged: runMetaDerivationSession()
  -> meta-DTU created (truth about truths)
```

### Autogen -> Governance -> Promotion
```
autogen-pipeline.runPipeline()
  -> noveltyCheck() -> determineWritePolicy()
  -> queued as proposal (worker thread)
  -> mergeCognitiveResults() (main thread)
  -> dtu.create macro -> STATE.dtus
  -> governance.reviewBundle()
  -> promotion-pipeline: regular -> mega -> hyper
```

### Dialogue -> Growth -> Pattern Learning
```
controller.runDialogueSession()
  -> dialogue.submitTurn() -> gates validation
  -> completeDialogueSession()
  -> growth.extractPatterns()
  -> growth.distillSession() -> summary DTU
  -> trust-network.extractTrustFromSession()
  -> growth.processReputationShift()
```

### Context Assembly
```
query arrives
  -> context-engine.processQuery()
  -> activation.spreadActivation() (via edges)
  -> getWorkingSetWithPins() (bounded working memory)
  -> extractCoActivationEdges() (learning)
  -> returned for LLM inference
```

## Invariants

1. **One-way flow**: Global -> Marketplace -> Local (never reverse)
2. **Speak, not decide**: Emergents propose; council governs
3. **Event-sourced**: Every mutation appended to journal.js
4. **Staging lattice**: Shadow workspace -> governance merge -> canonical
5. **Rate-limited**: Budget bucket per emergent (gates.js)
6. **Novelty enforced**: Anti-echo gate prevents repetition
7. **Perfect replay**: All state reconstructible from journal events
8. **Provenance tracked**: Every DTU records birth context
9. **Silent failure**: Modules never crash the heartbeat (try-catch)
10. **Worker isolation**: HTTP never blocked by cognitive computation
