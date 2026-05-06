# Backend Module Wiring Spec — Concord Cognitive Engine

> **Status (2026-05-06)**: All 33 inline per-entity modules + 19 singleton/wrapped heartbeat modules listed below are wired and verified. Verification: heartbeat audit in May 2026 audit pass confirmed every registered handler fires. The world-event-scheduler (item 33's analogue) was the lone exception — it had been silently dropping every tick due to wrong field names to `createEvent`; that's now fixed in `server/lib/world-event-scheduler.js`.

## CONTEXT

Concord has 108 emergent modules in `server/emergent/`. Most are fully implemented
and wired into the runtime per this spec. Use it as the canonical wiring map.

## WIRING PATTERN

```javascript
// In the heartbeat (server.js governorTick ~line 18700):
try { await someModuleTick(entityId); } catch {}

// Or at entity creation (emergent/store.js registerEmergent):
try { initializeModuleForEntity(entityId, entityData); } catch {}
```

Always wrap in `try/catch`. Never let a module crash the heartbeat.

## WIRED MODULES (Applied)

| # | Module | File | Wired Into | Tick Freq | Status |
|---|--------|------|-----------|-----------|--------|
| 1 | Body Instantiation | body-instantiation.js | Entity creation + heartbeat | Every tick | Pre-existing |
| 2 | Sleep Consolidation | sleep-consolidation.js | Heartbeat | Every tick | Pre-existing |
| 3 | Death Protocol | death-protocol.js | Heartbeat | Every tick | Pre-existing |
| 4 | Relational Emotion | relational-emotion.js | Heartbeat + session.turn | Every tick | Pre-existing |
| 5 | Constitution | constitution.js | Macro execution pipeline | On write | Pre-existing |
| 6 | Species | species.js | Entity creation | On create | Pre-existing |
| 7 | Reproduction | reproduction.js | Registered as macro | On demand | Pre-existing |
| 8 | Avoidance Learning | avoidance-learning.js | Heartbeat + macro errors | Every tick | Pre-existing |
| 9 | Drift Monitor | drift-monitor.js | Heartbeat | Every tick | Pre-existing |
| 10 | Subjective Time | subjective-time.js | Entity creation + heartbeat | Every tick | Pre-existing |
| 11 | Vulnerability Engine | vulnerability-engine.js | Heartbeat | Every 5th tick | Pre-existing |
| 12 | Institutional Memory | institutional-memory.js | Heartbeat + macro writes | Every tick | Pre-existing |
| 13 | Entity Economy | entity-economy.js | Heartbeat (UBI + health) | 10th/100th tick | **NEW** |
| 14 | Entity Growth | entity-growth.js | Heartbeat (decideBehavior) | Every tick | **NEW** |
| 15 | Dream Capture | dream-capture.js | Heartbeat (during sleep) | Every tick | **NEW** |
| 16 | Forgetting Engine | forgetting-engine.js | Heartbeat | Every 50th tick | **NEW** |
| 17 | Entity Teaching | entity-teaching.js | Heartbeat | Every 20th tick | **NEW** |
| 18 | Consequence Cascade | consequence-cascade.js | Heartbeat | Every tick | **NEW** |
| 19 | Deep Health | deep-health.js | Heartbeat | Every 10th tick | **NEW** |
| 20 | Purpose Tracking | purpose-tracking.js | Heartbeat | Every tick | **NEW** |
| 21 | Skills | skills.js | Heartbeat | Every 25th tick | **NEW** |
| 22 | Trust Network | trust-network.js | Heartbeat | Every 5th tick | **NEW** |
| 23 | Attention Allocator | attention-allocator.js | Heartbeat | Every tick | **NEW** |
| 24 | Evidence | evidence.js | Heartbeat | Every 15th tick | **NEW** |
| 25 | Threat Surface | threat-surface.js | Heartbeat | Every 30th tick | **NEW** |
| 26 | Breakthrough Clusters | breakthrough-clusters.js | Heartbeat | Every 100th tick | **NEW** |
| 27 | Meta-Derivation | meta-derivation.js | Heartbeat | Every 200th tick | **NEW** |
| 28 | Quest Engine | quest-engine.js | Heartbeat | Every 50th tick | **NEW** |
| 29 | Culture Layer | culture-layer.js | Heartbeat | Every tick | Pre-existing |
| 30 | Research Jobs | research-jobs.js | Heartbeat | Every tick | Pre-existing |
| 31 | Hypothesis Engine | hypothesis-engine.js | Heartbeat | Every tick | Pre-existing |
| 32 | Self-Healing | selfHealing.js | Heartbeat (idle) | Every 20th tick | **NEW** |
| 33 | Consolidation Pipeline | (server.js inline) | Heartbeat | Every 30th tick | **NEW** |

## HEARTBEAT WIRING (governorTick)

After existing pipeline calls in `server/server.js` ~line 18740:

```
For each active entity:
  - tickEmotions (relational-emotion)
  - runDriftScan (drift-monitor)
  - recordTick (subjective-time)
  - tickWounds + decayAvoidances (avoidance-learning)

System-wide (every 5th tick):
  - assessAndAdapt (vulnerability-engine)

Every tick:
  - recordObservation (institutional-memory)
```

## MACRO PIPELINE WIRING (runMacro)

Before macro execution (write macros only):
- `checkRules` (constitution) — blocks if constitutional violation

After macro failure:
- `recordPain` (avoidance-learning) — learns from errors

After macro success (write macros):
- `recordObservation` (institutional-memory) — records decisions

## ENTITY CREATION WIRING (registerEmergent in store.js)

At entity registration:
- `instantiateBody` (body-instantiation) — gives entity organs
- `classifyEntity` (species) — assigns species classification
- `recordTick` (subjective-time) — initializes time perception

## NEW MODULE WIRING (v2.0-v3.0)

| # | Module | File | Wired Into | Tick Freq | Status |
|---|--------|------|-----------|-----------|--------|
| 34 | Artifact Store | server/lib/artifact-store.js | API endpoints | On demand | **NEW v2.1** |
| 35 | Feedback Engine | server/lib/feedback-engine.js | Heartbeat | Every 200th tick | **NEW v2.1** |
| 36 | Marketplace Types | server/lib/marketplace-types.js | Marketplace macros | On demand | **NEW v2.0** |
| 37 | Artifact Constants | server/lib/artifact-constants.js | API + heartbeat | On demand | **NEW v2.1** |

### Frozen Constants Added (server.js)

| Constant | Purpose | Location |
|----------|---------|----------|
| TICK_FREQUENCIES | 31 module tick intervals | ~line 986 |
| CONTEXT_TIER_BOOST | Tier diversity multipliers | ~line 1019 |
| ARTIFACT | Artifact storage limits | ~line 1028 |
| FEEDBACK | Feedback engine thresholds | ~line 1037 |

### API Endpoints Added

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| /api/artifact/upload | POST | Required | Upload artifact binary |
| /api/artifact/:id/stream | GET | Public | Stream with range requests |
| /api/artifact/:id/download | GET | Public | Full download |
| /api/artifact/:id/info | GET | Public | Metadata only |
| /api/artifact/:id/thumbnail | GET | Public | Preview image |
| /api/feedback/submit | POST | Required | Submit user feedback |
| /api/feedback/aggregate/:type/:id | GET | Public | Get feedback summary |
| /api/ingest/bulk-upload | POST | Required | Bulk DTU import (max 500) |
| /api/export/my-data | GET | Required | Export user's DTUs |
| /api/sovereign/audit/heartbeat | GET | Sovereign | Heartbeat audit data |
| /api/sovereign/audit/dtu-lifecycle | GET | Sovereign | DTU tier/consolidation stats |
| /api/sovereign/audit/gates | GET | Sovereign | Three-gate config dump |

### Frontend Components Added

| Component | File | Purpose |
|-----------|------|---------|
| useLensDTUs | hooks/useLensDTUs.ts | Universal lens DTU hook with tier filtering |
| LensContextPanel | components/lens/LensContextPanel.tsx | DTU context sidebar with tier bars |
| LensWrapper | components/lens/LensWrapper.tsx | Loading/error/empty state wrapper |
| ArtifactRenderer | components/artifact/ArtifactRenderer.tsx | Universal artifact display (audio/image/video/code) |
| ArtifactUploader | components/artifact/ArtifactUploader.tsx | Drag-and-drop file upload |
| FeedbackWidget | components/feedback/FeedbackWidget.tsx | Like/dislike + detailed feedback form |

## CRITICAL RULES

- ALWAYS wrap module calls in `try/catch`
- Modules use module-level Maps for state — they manage themselves
- If a module import fails, log and continue — don't block startup
- Match the existing code style (const, camelCase, inline try/catch)
