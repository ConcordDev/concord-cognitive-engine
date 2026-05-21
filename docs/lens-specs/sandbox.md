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
- [ ] `[M]` 3D rendered scene — currently 2D dummy buttons; render the actual world-lens 3D arena
- [ ] `[S]` Frame-time / hitstop telemetry overlay — measure combat-feel numerically
- [ ] `[S]` Dummy behavior presets — aggressive/defensive/idle dummies, not just static targets
- [ ] `[S]` Weapon/skill loadout picker UI — swap weapons and skills without URL editing
- [ ] `[S]` Slow-motion + frame-step — inspect hit reactions frame by frame
- [ ] `[S]` Record + replay a combat sequence

## Parity
~60% of a combat test scene. It does the essential job — real production combat against configurable dummies with the full presentation overlay stack — but it is a 2D button grid; a 3D rendered arena and a frame-time telemetry overlay would make it a proper feel-tuning tool.
