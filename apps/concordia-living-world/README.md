# Concordia living-world

Browser prototype of the nine-world hub (combat, creatures, quests, politics, persistence).

This folder is the **canonical snapshot** of the Aug 2026 Grok Build passes on branch `grok/concordia-living-world` ([PR #944](https://github.com/ConcordDev/concord-cognitive-engine/pull/944)).

Not wired into `concord-frontend` / Godot.

## Passes on this branch

1. Living-world kernel — eight doors, ecology, politics, quests, persistence
2. Playable AAA slice — Mixamo Soldier, Kenney/fauna/ruin GLBs, rigged figures, camera-from-behind, Unity Mac handoff

## Layout

| Path | What |
|---|---|
| `src/game/` | Sim, combat, lore, locomotion, Mixamo clips |
| `src/components/concordia/` | R3F world, HUD, rigged figures, Kenney field |
| `public/models/` | Soldier / Kenney / fauna / ruins GLBs |
| `unity-client/` | Unity 6 URP project (Hub plaza playable in Editor). Open from this repo — do not copy out. |
| `bible/` | Living specs (LIVE vs TARGET). Authority: Concord owns sim, Unity owns presentation. Visual stack: `bible/VISUAL.md`. |
| `HANDOFF.MAC.md` | Mac Unity Hub instructions (in-repo project) |
| `CONCORDIA_SYSTEM_AUDIT.md` | 2026-09-01 code-vs-play audit |
| `CONCORDIA_AAA_GAP_REPORT.md` | Remaining AAA gaps |
| `REALISM_GAP_REPORT.md` | Realism / art gaps |

Open the whole stack (this app + Unity + Godot + frontend + server + mobile) via the repo-root `concord.code-workspace`.

## Play

This snapshot is source + assets. The runnable Grok Build app that produced it lives at `https://github.com/ConcordDev/concordia` (Vite + R3F). Do not rewrite the sim in Unity from scratch — see `HANDOFF.MAC.md`.

### Unity (desktop client, in this repo)

1. Install **Unity 6** (`6000.5.x`, URP) via Unity Hub.
2. Hub → Open → `apps/concordia-living-world/unity-client/` (this folder, not a copy).
3. Play `Assets/Scenes/ConcordiaHub.unity`. `Library/` regenerates locally and is gitignored.
4. `/unity-ws` is mounted on the Concord server (`server/lib/unity-bridge.js`); `ConcordClient` is the socket client. The Hub currently plays offline — connecting it is a follow-on, not a copy-the-project step.
