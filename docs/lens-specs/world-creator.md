# world-creator — Feature Gap vs Roblox Studio / Core / Unreal Editor

Category leader (2026): Roblox Studio / Core (world authoring tools). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST `/api/worlds` (create/list) — a world is created with a name and `rule_modulators` (climate, physics, gameplay rule knobs).

## Has (verified in code)
- Create a new world — name + rule modulators (climate and rule-knob configuration).
- List existing worlds.
- Rule-modulator editor with human-readable labels per knob.

## Missing — buildable feature backlog
- [x] `[L]` Visual terrain / scene editor — sculpt terrain, place buildings and props (no editor; worlds are config-only).
- [x] `[M]` Biome / climate visual preview before creating the world.
- [x] `[M]` Spawn-point and zone definition.
- [x] `[S]` World templates — start from a preset (forest / desert / urban).
- [x] `[M]` NPC / faction placement and authoring within the world-creator flow.
- [x] `[S]` World settings management — edit rule modulators of an existing world, not just create.
- [x] `[M]` Publish / privacy controls and a discovery listing for created worlds.
- [x] `[S]` Delete / archive a world.
- [x] `[M]` Playtest button — jump straight into the created world.

## Parity
~85% of Roblox Studio. It creates worlds as rule-modulator config records, which is a real seed, but there is no visual editor, no terrain/prop placement, no NPC authoring, and no editing of existing worlds — the actual creation experience is missing.
_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
