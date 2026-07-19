# Hero mesh asset credits

The 7 base archetype slots (`_archetype_*.glb`, including all per-world
suffixed variants) are populated with real, textured, animated, correctly
Mixamo-bone-named character models, replacing the flat-shaded procedural
placeholders that shipped previously. Source and license:

- **Soldier.glb** (used for `warrior`, `guard`, `hunter`) — the "Vanguard"
  character, originally from Adobe's Mixamo free character library
  (mixamo.com), redistributed by the three.js project as an official
  example asset at `examples/models/gltf/Soldier.glb`
  (https://github.com/mrdoob/three.js, MIT-licensed repository; the
  three.js example page explicitly credits "model from mixamo.com").
  Ships with baked Idle/Run/TPose/Walk animation clips (unused by this
  project — Concordia drives bones directly via its own gait-synthesis
  system — but harmless to keep).
- **Michelle.glb** (used for `scholar`, `mystic`, `trader`) — same
  provenance, `examples/models/gltf/Michelle.glb`.
- **Xbot.glb** (used for `legend`) — Mixamo's standard default test
  character, same provenance, `examples/models/gltf/Xbot.glb`.

All three are Mixamo-sourced content, which Adobe licenses for free use
(including in commercial, shipped projects) without a royalty or mandatory
attribution requirement. This file exists as a provenance record and as
the easiest place to swap in different/better character art later — every
file here is a drop-in replacement as long as the skeleton keeps the
`mixamorig:`-prefixed Mixamo bone names documented in `README.md`.

The four named "Three Above All" meshes (`sovereign_first_refusal.glb`,
`concord_first_thought.glb`, `concordia_first_breath.glb`,
`weaver_of_echoes.glb`) are unchanged by this pass — they're lore-unique
entities that deserve bespoke art rather than a reused stock rig, so they
were deliberately left on the existing procedural-placeholder path pending
dedicated authored work.

Per-archetype files (including every world-suffixed variant) currently
reuse one of these three base meshes verbatim — there's no per-world
recoloring/retexturing pass yet. That's an honest limitation, not a
regression: every NPC that reaches this fallback tier previously got a
flat-shaded, untextured placeholder; now it gets a real, textured, rigged
character. Differentiating per-world archetype looks (recoloring gear,
swapping textures) is a natural follow-up, not a blocker for this upgrade.
