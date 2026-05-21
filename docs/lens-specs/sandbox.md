# sandbox — Feature Gap vs a game combat-feel test scene

Category leader (2026): no consumer rival — closest analog is an in-engine combat/animation test scene (Unity/Unreal test arena). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: uses the live world combat pipeline — `/api/worlds/:worldId/combat/attack` + socket events — against a private `sandbox` world; no domain macros.

## Has (verified in code)
- Flat checkered arena with 1–10 configurable training dummies (URL params `?dummies=N&weapon=`)
- Real combat: left-click light / right-click heavy attacks through the production combat socket path (with anti-cheat reach + damage-cap validation)
- Live hit log, per-dummy HP bars, reset/add/remove dummy controls
- Combat presentation overlays from the live world: ImpactFeedback, GameJuice, ComboEvolvedBridge, BodyLanguageOverlay
- Lock-on controls (soft/hard); keyboard shortcuts for combat-feel iteration

## Missing — buildable feature backlog
- [x] `[M]` 3D rendered scene — currently 2D dummy buttons; render the actual world-lens 3D arena
- [x] `[S]` Frame-time / hitstop telemetry overlay — measure combat-feel numerically
- [x] `[S]` Dummy behavior presets — aggressive/defensive/idle dummies, not just static targets
- [x] `[S]` Weapon/skill loadout picker UI — swap weapons and skills without URL editing
- [x] `[S]` Slow-motion + frame-step — inspect hit reactions frame by frame
- [x] `[S]` Record + replay a combat sequence

## Parity
~95% of a combat test scene. Real production combat against configurable dummies plus a 3D rendered Three.js arena, a frame-time/hitstop telemetry overlay, dummy behavior presets, a weapon/skill loadout picker, slow-motion + frame-step, and combat record/replay all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
