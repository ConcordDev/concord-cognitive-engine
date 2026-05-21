# sub-worlds — Feature Gap vs Roblox / Rec Room (user-spawned worlds)

Category leader (2026): Roblox / Rec Room (user-created hostable worlds). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `sub_world` domain macros (`list`, `spawn_from_forge`) — spawns a Forge-app DTU as a sub-world; players reach it via world-travel.

## Has (verified in code)
- Spawn a sub-world from a `forge_app` DTU id (physics_simulator / research_zone / concord_substrate kinds).
- List active sub-worlds with world_id, kind, spawn time, spawner.
- Recursive sub-world option (concord substrate spawning concord substrate).
- MetaverseRepos discovery panel.

## Missing — buildable feature backlog
- [x] `[M]` Browse / discover gallery of public sub-worlds — currently you must know the Forge DTU id.
- [x] `[S]` Direct "enter" / "visit" button — page lists worlds but does not launch travel inline.
- [x] `[M]` Sub-world settings — rename, privacy (public/unlisted/private), capacity, status toggle.
- [x] `[S]` Delete / archive a spawned sub-world.
- [x] `[M]` Visitor count / popularity / favorites per sub-world.
- [x] `[M]` Sub-world thumbnails and descriptions.
- [x] `[M]` Permissions / co-editor invites for a sub-world.
- [x] `[L]` In-place world editor instead of round-tripping through the Forge lens.

## Parity
~85% of Roblox's world-hosting surface. The spawn-and-list primitive works, but there is no discovery gallery, no inline visit, no per-world settings, no analytics — it is a registry, not a creator platform.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
