# Concordia Runtime Systems Integration

## Scope
Integrate the existing World Field, Universal Fabrication, and opt-in ConKay diagnostic systems through canonical `Assets/Concordia/Scripts` runtime seams without creating parallel authorities.

## Audit
- Read the existing GameplayCoreBridge, ConcordiaGame, persistence, WorldField, fabrication, and ConKay sources.
- Identify current APIs, compile risks, and the smallest safe integration points.

## Implementation
- Expose one WorldField sample through the bridge and route field-aware interaction/capability resolution through it.
- Connect fabrication/provenance persistence and runtime interaction to existing economy/persistence seams.
- Add a universal read-only interaction resolution result with deterministic refusal/why details, preserving legacy handlers as fallbacks.
- Keep ConKay opt-in/read-only and bind it to confirmed runtime adapters without changing renderer or locomotion.

## Verification
- Refresh/compile the Unity project.
- Check compile errors and inspect changed canonical files for consistency.
- Report only observed changes and verification results.