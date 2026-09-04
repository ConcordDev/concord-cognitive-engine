# Concordia bible

Living specs. Every file states **LIVE** (verified in code or play) vs **TARGET** (construction spec).

Code that changes a LIVE fact must update the matching file in the same change.

Authority: **Concord owns simulation. Unity owns presentation.** See `UNITY_CONCORD_CONTRACT.md`.

Audit: `../CONCORDIA_SYSTEM_AUDIT.md` (2026-09-01). Do not treat browser `src/game/*.ts` as Unity-live.

| Doc | LIVE snapshot |
|---|---|
| WORLD | 10 kingdoms + refusals; CityAtlas settlements; CrossRing caravans/tariffs/plots/travelers; WorldClock hours + authored events persist across gates |
| VISUAL | DressVocab culture kits; imported My Assets (Store or Assets/<Pack>/) first, Kenney fallback; fake-window LOD; listed != imported |
| LORE | JSON under `Resources/Concordia/Canon/` + `bible.ts` |
| CHARACTERS | Hub guests speak; faction sash on authored people; unlabeled ambient stay unlabeled; talk carries last event as rumor |
| FACTIONS | JSON camps + weapon kits; sash color from `visual.primary_color` |
| COMBAT | Unity hitscan; Hostile perceives / strafes; physics combat in `src/game/combat.ts` only |
| QUESTS | Accept/track/complete for talk / reach / defeat / gather; HUD notes thin ecology |
| SKILLS | Local attempt/connect ledger |
| NPC_BRAIN | Unity schedules + visible activities (open/patrol/deliver/talk/inside); REAL/BULK/VIRTUAL LOD |
| SAVE_SYSTEM | Appearance JSON + `concordia-living-v1.json` world slices |
| NETWORK | `/unity-ws` mounted; `kingdom:request` → authored snapshot; offline stays `no_gateway` |
| ANIMATION | Hero prefers Soldier.glb + SoldierLocomotion; NPC gait still often procedural |
| AUDIO | Prefab paths; Vrellan Six missing |
