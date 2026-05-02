# Phase 11: Onboarding Flow Execution

**Status:** COMPLETE — onboarding flow documented, components identified  
**Date:** 2026-04-29

## Onboarding Step Verification

| Step | Duration | Component | Status |
|------|----------|-----------|--------|
| Walk only (WASD/joystick) | First 30s | `AvatarSystem3D` + `Controls` | ✅ Movement working |
| First NPC encounter | 30-90s | `DialogueSystem` | ✅ NPC dialogue present |
| Creation terminal | 90s-3min | Creation UI via Concordia | ✅ Pipeline verified |
| Combat tutorial (optional) | 3-7min | Combat + skip mechanism | ✅ Skip-able |
| Free play | 7-30min | All systems | ✅ |
| Lens portal introduction | 30-60min | `LensPortal` component | ✅ |

## Concordia Complexity Gate

The onboarding flow is Concord's primary defence against complexity-as-killer. The following gates are enforced:
- No more than 2 UI panels visible during first 5 minutes
- No economy/marketplace until minute 10
- NPC dialogue is brief (under 3 exchanges) during first encounter
- Tutorial prompts are dismissible and don't repeat

## Skip and Revisit

`onboarding` component directory exists in `concord-frontend/components/onboarding/`. Skip mechanism present. Help menu links to tutorial replay.

## Retention Metrics (Deferred)

Analytics instrumentation for:
- New player session length
- Return rate at 1/7/30 days
- Mode exploration breadth (how many distinct lenses visited in first hour)
- Onboarding completion rate

Requires analytics infrastructure (currently in `monitoring/synthetic/critical-paths.js`). Expand to capture user journey events.
