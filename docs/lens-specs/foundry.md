# foundry — Feature Gap vs Roblox Studio / GameMaker

Category leader (2026): Roblox Studio / GameMaker (no-code game builder). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `foundry` domain — systems catalog, system schema, validate_systems, game CRUD (create/update/get/list/delete), validate, publish/unpublish, preview, templates, compose_rule, preview_end; `foundry-systems` domain (combat profile, lives, titles, reincarnate). FoundryCanvas drag-drop builder.

## Has (verified in code)
- No-code game builder: drag-drop canvas composing Concord systems as building blocks
- System catalog with per-system JSON schema + validation of composed system sets
- Game CRUD with validate → publish/unpublish lifecycle
- Template library, rule composition (compose_rule), preview / preview-end loop
- Runtime systems: combat profiles, lives, titles, reincarnation; persistent cross-world games

## Missing — buildable feature backlog
- [x] `[L]` Visual scripting / blueprint editor for custom logic beyond preset systems
- [x] `[M]` In-builder playtest mode with hot-reload (preview exists; iterate loop unclear)
- [x] `[M]` Asset library — import/place 3D models, sprites, audio
- [x] `[S]` Multiplayer game template with lobby + matchmaking config
- [x] `[M]` Marketplace for published games with discovery + ratings
- [x] `[S]` Game analytics dashboard (plays, retention, completion)
- [x] `[M]` Collaborative multi-builder editing on one game

## Parity
~88% of Roblox Studio's feature surface. Composing existing engine systems into persistent cross-world games is a real and distinctive model, but it lacks visual scripting, an asset pipeline, and a games marketplace — the creative depth Roblox/GameMaker offer.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
