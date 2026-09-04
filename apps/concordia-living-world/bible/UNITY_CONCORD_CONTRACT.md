# UNITY_CONCORD_CONTRACT

**Status:** TARGET (boundary stated) · LIVE (violated)  
**Authority:** Concord  

## LIVE (2026-09-01)

Unity `ConcordiaPlayer.HitScan` mutates dummy HP. `ConcordiaGame.Travel` is the world transition. `ConcordClient` to `wss://live.concordos.ai/unity-ws` was **not connected**. Server `mountUnityGateway` (`server/lib/unity-bridge.js`) reuses `mountGodotGateway` at `/unity-ws`.

Unity owns (and should keep): camera, animation playback, VFX, audio playback, UI, streaming/LOD presentation.

## TARGET

Concord owns: time, weather, NPC state, memory, factions, economy, combat math, quests, ecology, persistence, 2B decisions, verification.

If Unity or a model claims kill/parry/quest-complete, Concord answers EXECUTED / OBSERVED / VERIFIED / COMPLETED.

Envelope: `{ evt, data }`. Combat intent: `combat:attack`. Never `unity:` as a second physics.

## Gap

Close local damage and travel. Honest fail `{ ok:false, reason:'no_gateway' }` when socket down — no fabricated success.
