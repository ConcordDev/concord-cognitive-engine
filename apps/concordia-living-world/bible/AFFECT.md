# AFFECT

**Status:** LIVE (platform ATS + creature instinct stack) · PARTIAL (AgentBody P0 binds characterId → affect_state) · MISSING (Hub hero/guests still unwired; P1 combat/needs ticks)  
**Authority:** Concord  
**Source:** `server/affect/`; `server/lib/affect-bridge.js`; `server/lib/ecosystem/{core-affect,drives,umwelt,creature-needs}.js`  
**Agent embodiment:** see `AGENT_BODY.md` §6

## LIVE (platform)

- ATS engine dimensions: valence, arousal, stability, coherence, agency, trust, fatigue (`v,a,s,c,g,t,f`).
- Persistence via `affect_state` / `affect_events_log`; `applyAffectEvent` fail-safe.
- Creature flock: umwelt → core affect → Panksepp drives → instinct; needs include hunger/thirst/energy/safety; pain in core-affect ctx.
- Affect **lens** (mood analytics) is a separate user-facing product surface.

## MISSING in Concordia presentation

Hub guests and the human/hero pawn still do **not** round-trip ATS. Unity `LivingBody` presents hunger/fatigue from the WorldClock hour rate until the gateway ticks. AgentBody P0 persists `affect_state` for `characterId` on create/bind; combat/weather/hunger ticks are P1.

## TARGET

- Every `characterId` (human or agent) owns an affect row per world.
- Combat wounds, weather/comfort, hunger ticks, social gift/talk → `applyAffectEvent` / needs decay.
- Salience spikes wake AgentBody deliberation (`agent:affect_interrupt`).
- Does not replace goals/charter; biases stance and interrupts.

## Gap

Unwired to Unity Hub. Creature stack proves the science path; AgentBody must reuse it, not invent a second emotional OS.
