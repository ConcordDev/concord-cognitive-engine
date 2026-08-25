# Concordia — handoff for Grok on Mac (2026-08-25)

You are continuing Concordia. This snapshot lives on
[`grok/concordia-living-world`](https://github.com/ConcordDev/concord-cognitive-engine/pull/944)
under `apps/concordia-living-world/`. The runnable browser game (Vite + Three.js)
is also at `https://github.com/ConcordDev/concordia`. Unity on the Mac is the
**desktop client kitchen**. The live site is Concordos on the GPU pod.

Read this before writing code. Do not rewrite the sim in Unity from scratch.

## Product

- **One game, two doors:** play in the browser, download desktop later.
- Browser runtime stays this repo (Vite + Three.js + R3F) until a Unity WebGL build exists.
- Unity is for Mixamo humanoids, sockets, lighting, standalone Windows/macOS/Linux.
- Concordos live site is the storefront + world gateway. Not a Unity rewrite of the OS.

## This snapshot (browser Concordia)

Canonical copy: `apps/concordia-living-world/` on
[PR #944](https://github.com/ConcordDev/concord-cognitive-engine/pull/944)
(`grok/concordia-living-world`). Runnable Grok Build app:
`https://github.com/ConcordDev/concordia`.

Playable now:

- Mixamo Soldier player, sword parented to RightHand, camera shows the back
- Combat in every world except the hub (flower-law in the Court, live steel off-hub)
- Lore is playable: HUD refusal + law, waystones (E to read), hunt/road/talk quests
- Files that matter: `src/game/bible.ts`, `src/game/lore-play.ts`, `src/game/combat.ts`,
  `src/components/concordia/RiggedFigure.tsx`, `src/components/concordia/GameCanvas.tsx`

```bash
npm install
npm run dev
```

## Live site (pod)

RunPod A40. Concordos:

- Frontend `/play` and `/download` (storefront)
- Backend `/godot-ws` and `/unity-ws` (same scene descriptor)
- Godot world client already exports Web + Linux
- Unity gateway mounted (`server/lib/unity-bridge.js`)

SSH (key already on the pod account):

```
ssh -p 22054 -i ~/.ssh/id_ed25519 root@194.68.245.74
```

On the pod:

| Path | What |
|---|---|
| `/workspace/concord-cognitive-engine` | Live Concordos |
| `/workspace/unity/editor` | Unity 6.5.9 Linux Editor (extracting/extracted) |
| `/workspace/unity/projects/Concordia` | Unity client skeleton |
| `/workspace/unity/unity-mcp` | Coplay MCP v10 clone |
| `/workspace/unity/projects/Concordia/Assets/Scripts/ConcordClient.cs` | `/unity-ws` client |

## What you do on the Mac (Unity Hub)

1. Finish installing **Unity 6** (6000.5.x or whatever Hub offers; URP).
2. Create or open a project named **Concordia**.
3. Copy `Assets/Scripts/ConcordClient.cs` from this repo (`unity-client/` once pushed) into the Mac project.
4. Install package: `https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#v10.0.0`
5. Window → MCP for Unity → Configure (so this Grok can drive the Editor).
6. Import Mixamo: idle / walk / run / slash / heavy / hit / jump. Humanoid avatar.
7. Right hand socket for the sword. Camera behind the back.
8. Export GLB clips back into this repo `public/models/` for the browser game.
9. Standalone builds go on the live site `/download` later.

Do **not** wait for the Linux Editor on the pod to license. The Mac Hub login is the license.

## Do not

- Replace Concordos with a Unity-only app
- Freeze the sim on hitstop
- Parent weapons to the left hand
- Face the character opposite the run direction (Mixamo visor is −Z)
- Commit `node_modules`, SSH keys, or `tools/unity-mcp`

## Next slice (priority)

1. Mac Unity: one certified humanoid + sword in RightHand + walk/run/slash
2. Export those clips/GLB into this repo
3. Linux desktop Godot/Unity build onto `/download`
4. Keep `/play` as the browser world client
