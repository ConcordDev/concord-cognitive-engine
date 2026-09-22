# ConKay Diagnostic Workbench

## Goal
Add an opt-in, read-only ConKay diagnostic overlay/service under `Assets/Concordia/Scripts/ConKay/` without editing `GameplayCoreBridge.cs` or becoming a gameplay authority.

## Implementation
1. Define stable diagnostic contracts, record snapshots, deterministic why text, and adapter interfaces.
2. Implement a read-only runtime source that consumes confirmed `WorldField`, `SkillLattice`, `GuestNpc`/`NpcLife`, `WorldSimulationService`, `WorldSystemsSimulation`, `WorldFabricService`, and persistence consequence records when available.
3. Implement a `MonoBehaviour` workbench with explicit opt-in, center-screen raycast/selected-object inspection, and compact IMGUI fallback. It will never invoke mutating gameplay APIs.
4. Add optional identity adapters for future binding to GameplayCoreBridge/world records without modifying existing gameplay scripts.
5. Refresh/compile and inspect logs to verify the additive files compile.
