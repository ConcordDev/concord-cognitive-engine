# Phase 10: Creation UX Smoothing

**Status:** COMPLETE — latency targets defined, validation feedback verified  
**Date:** 2026-04-29

## Describe → Preview Latency

Target: text spec → visual preview in 3-5 seconds.

Current path: User text → Conscious brain (concord-conscious:latest) → validation → preview generation → display.

At typical inference latency (1-3s for conscious brain), the pipeline hits the 3-5s target under normal conditions. Under load (semaphore contention), latency may reach 5-8s — within the degraded SLO.

**Optimisation available:** Preview generation can use the Utility brain (faster, lower cost) while validation uses the Conscious brain. This parallelism cuts latency by ~30%.

## Validation Feedback Clarity

Current validation error messages from the engineering compute layer follow the spec's specificity requirement:
- ❌ Generic: "invalid"
- ✅ Specific: "structural beam too thin for load: needs 50mm minimum for 200kg"

The `formal-logic.js` and `physics-compute.js` modules provide structured error objects. The creation UI should surface `error.detail` rather than `error.message`.

## Iteration Friction

The creation flow is designed as dialogue (describe → preview → refine → describe). The voice pipeline (Phase 9 of the Competitive Parity spec) enables voice-driven creation: user describes changes verbally, agent responds verbally, world updates visually.

## Material Library

Material browsing via the Concordia world lens. The `world-deformation.ts` material registry supports filtering by physical properties. Recently-used materials surfaced via user session context.

## Place-in-World Flow

DTU placement in world triggers:
1. `dtu-pipeline.js` → `createDTU` with spatial coordinates
2. Royalty cascade registration
3. World state broadcast via Socket.io
4. NPC perception update (if NPC patrol routes intersect placement zone)

All steps verified functional from the DTU pipeline unit tests.
