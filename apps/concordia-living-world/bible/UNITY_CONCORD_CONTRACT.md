# UNITY_CONCORD_CONTRACT

**Status:** TARGET (boundary stated) · LIVE (violated)  
**Authority:** Concord  

## LIVE (2026-09-01)

Unity `ConcordiaPlayer.HitScan` mutates dummy HP. `ConcordiaGame.Travel` is the world transition. `ConcordClient` talks `{evt,data}` to `/unity-ws` (`mountUnityGateway` → `mountGodotGateway`). After auth it sends `scene:request` and `kingdom:request`. Talk (E) sends `dialogue:request`; Concord 2B (`qwen3.5:2b`) answers on `dialogue:data`. Convai's `IConversationProvider` is `concord-2b`, not the Convai cloud LLM. Offline Editor play stays `{ok:false, reason:'no_gateway'}` — never a fabricated connected kernel.

Unity owns (and should keep): camera, animation playback, VFX, audio playback, UI, streaming/LOD presentation.

## TARGET

Concord owns: time, weather, NPC state, memory, factions, economy, combat math, quests, ecology, persistence, 2B decisions, verification.

If Unity or a model claims kill/parry/quest-complete, Concord answers EXECUTED / OBSERVED / VERIFIED / COMPLETED.

Envelope: `{ evt, data }`. Combat intent: `combat:attack`. Never `unity:` as a second physics.

## Gap

Close local damage and travel. Honest fail `{ ok:false, reason:'no_gateway' }` when socket down — no fabricated success.
