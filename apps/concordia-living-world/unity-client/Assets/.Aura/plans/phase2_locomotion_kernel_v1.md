# Phase 2 Locomotion Kernel

## Goal
Create a new, non-conflicting movement foundation under `Assets/Concordia/Scripts/GameplayCore/Movement/` without modifying existing Concordia gameplay files.

## Steps
1. Inspect the Phase 0 genome and current `ConcordiaPlayer`, `AgentMotor`, `Grounding`, `LivingBody`, `ChaseCamera`, and `ModularPerson` contracts.
2. Add isolated locomotion contracts and state machine types for grounded, airborne, swimming, climbing, flight, and superspeed contexts, including input, surface, stamina, and animation snapshots.
3. Add a collision-safe CharacterController motor that performs acceleration/braking, gravity/slope response, capsule clearance checks, and a single authoritative Move per tick.
4. Add adapters/probes that reuse the existing CharacterController, `Grounding`, `LivingBody`, `ChaseCamera`, `AgentMotor`, and `ModularPerson` conventions without editing those shared files.
5. Add the orchestrating `LocomotionKernel` component plus opt-in context/surface volume components; keep it detached from the current runtime until later integration.
6. Refresh/compile and inspect console errors; report created paths and remaining integration hooks honestly.