# Concordia bible

Living specs. Every file states **LIVE** (verified in code or play) vs **TARGET** (construction spec).

Code that changes a LIVE fact must update the matching file in the same change.

Authority: **Concord owns simulation. Unity owns presentation.** See `UNITY_CONCORD_CONTRACT.md`.

Audit: `../CONCORDIA_SYSTEM_AUDIT.md` (2026-09-01). Do not treat browser `src/game/*.ts` as Unity-live.

| Doc | LIVE snapshot |
|---|---|
| WORLD | 9 worlds + refusals in `Canon.cs` |
| LORE | JSON under `Resources/Concordia/Canon/` + `bible.ts` |
| CHARACTERS | Hub guests speak; no relationship graph |
| FACTIONS | JSON camps; no sim tick |
| COMBAT | Unity hitscan; physics combat in `src/game/combat.ts` only |
| NPC_BRAIN | Unity 5 jobs; TS `NpcBrain` not in Unity |
| SAVE_SYSTEM | Appearance JSON only |
| NETWORK | `/unity-ws` unused this play |
| ANIMATION | Soldier T-pose |
| AUDIO | Prefab paths; Vrellan Six missing |
