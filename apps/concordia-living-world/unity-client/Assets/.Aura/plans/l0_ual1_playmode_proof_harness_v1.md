# L0 UAL1 PlayMode Proof Harness

## Goal
Close the L0 visible proof gap using the existing ConcordiaLocomotion controller, real ConcordiaPlayer/ModularPerson runtime body, and existing capture flow without replacing CX/Rocketbox assets or treating UAL1 as a mesh.

## Steps
1. Inspect the existing capture rig, runtime player input methods, controller bindings, and test layout.
2. Add a deterministic PlayMode test harness under the dedicated animation tests. It will load the real hub scene when needed, wait for the live player/body, drive the public runtime movement/action entry points, sample Animator states and transform motion, render proof frames, and write a marker only after all visible samples succeed.
3. Run the targeted PlayMode test if the editor/test runner permits it.
4. Verify console/test result and evidence files; report PASS only for an observed body sequence, otherwise report the exact blocker while retaining the reusable harness.

## Constraints
- Modify only the animation/proof slice and dedicated tests/proof outputs.
- Preserve authored CX/Rocketbox identity meshes and UAL1 animation-only usage.
- No structural-only PASS; visible observation is required before marker creation.