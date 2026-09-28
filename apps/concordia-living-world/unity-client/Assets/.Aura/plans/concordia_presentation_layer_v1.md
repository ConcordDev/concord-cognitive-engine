# Concordia Presentation Layer

## Scope
Implement a new, additive presentation layer under `Assets/Concordia/Scripts/GameplayCore/Presentation/` without editing shared gameplay files. It will consume the existing `ConcordiaPlayer`, `ChaseCamera`, `ModularPerson`, `CombatFeel`, `FreePacks`, `Canon`, and GameplayCore locomotion contracts.

## Work items
1. Add a JSON-backed world presentation manifest with per-world visual language, camera tuning, animation context labels, VFX keys, and audio hook keys. Record only confirmed repository-backed assets; explicitly leave Poly Haven/HDRI bindings optional when absent.
2. Add a runtime presentation director that auto-installs after scene load, follows the dynamically-created player/camera, feeds contextual locomotion snapshots to Animator parameters and the existing locomotion state machine, applies world/combat camera contexts, and registers toast/health feedback hooks.
3. Add additive hit/UI feedback with imported-pack VFX lookup, procedural particle fallback (no character primitives), audio clip lookup plus generated transient fallback, and LODGroup/culling setup for authored renderers.
4. Add an editor validation/binding utility and presentation README documenting Rocketbox as the required human source, confirmed paths, and remaining external Poly Haven staging limitation.
5. Refresh/compile and inspect diagnostics where the editor connection permits; do not claim PlayMode or live gateway verification.

## Constraints
- Never replace Rocketbox or other authored bodies with primitives.
- Do not modify existing shared gameplay scripts in this parallel stage.
- Do not claim Poly Haven is imported; bind only confirmed assets and expose optional paths.
- Verify created files and report integration points and unverified runtime paths.