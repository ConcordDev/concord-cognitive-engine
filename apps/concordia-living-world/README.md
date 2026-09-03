# Concordia living-world

Unity is the **game client**. Concord server is the **kernel**. The Vite `src/game/` tree in this folder is a **browser prototype** — keep it as spec/reference; do not grow a third sim.

| Path | Role |
|---|---|
| `unity-client/` | AAA presentation (input, animation, feel). Speaks `{evt,data}` to `/unity-ws`. |
| `src/game/` | Browser prototype kernel (combat.ts, npc-life.ts, persist.ts). Superseded as live sim. |
| Concord `server/` | Combat resolution, NPC heartbeats, travel authority, DTUs. |

The Three.js world-lens (`concord-frontend/app/lenses/world/`) is the **OS world surface** (DTUs, presence, stations), not the combat client.

This folder also holds the Aug 2026 Grok Build snapshot on branch `grok/concordia-living-world` ([PR #944](https://github.com/ConcordDev/concord-cognitive-engine/pull/944)).

## Layout

| Path | What |
|---|---|
| `src/game/` | Spec/reference sim (do not add new live mechanics here) |
| `src/components/concordia/` | R3F prototype HUD |
| `public/models/` | Soldier / Kenney / fauna / ruins GLBs |
| `unity-client/` | Unity 6 URP client. Scripts in `Assets/Concordia/Scripts/`. Mixamo FBX stays local (`Assets/Concordia/Models/`, gitignored). |
| `HANDOFF.MAC.md` | Mac Unity kitchen instructions |
| `CONCORDIA_AAA_GAP_REPORT.md` | Remaining AAA gaps |
| `REALISM_GAP_REPORT.md` | Realism / art gaps |

## Play

Open `apps/concordia-living-world/unity-client/` in Unity Hub (see `concord.code-workspace`). With Concord listening on `:5050`, the client tries `wss://live.concordos.ai/unity-ws` then `ws://127.0.0.1:5050/unity-ws`. No gateway → honest `{ok:false, reason:'no_gateway'}` and local sandbox HP only.

Do not rewrite the sim in C#. Present the kernel.
