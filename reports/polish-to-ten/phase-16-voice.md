# Phase 16 — Voice Barge-In + Dialogue Mix Ducking

## Goal

Make the audio mix react to NPC dialogue: drop SFX during speech, restore on end. Wire a barge-in handler so the player can interrupt an NPC mid-sentence.

## Pre-implementation discovery (recap)

The original audit reported voice as "100% stub." The deeper Block-C-precursor sweep proved that wrong:

- **Backend TTS:** `server/server.js:8951-9011` exposes `voice.tts` macro with Piper local + OpenAI cloud fallback
- **Voice pipeline:** `server/lib/voice/voice-pipeline.js` — Audio → STT → Inference → TTS at <700ms
- **Voice routes:** `server/routes/voice-agent.js` exposes `/api/voice/session/create`, `/turn`, **and `/barge-in`**
- **NPC voices on the client:** `components/world/NPCDialogue.tsx:74-98, 325-405` already uses Web Speech API with per-archetype voice profiles. Working.

So the spec's "build TTS backend" subtask was unnecessary — Piper already runs. The actual gap was **mix coordination**: nothing told the audio system that a dialogue was happening, and nothing let an external trigger barge in.

## Changes

### `concord-frontend/components/world/NPCDialogue.tsx`

Three small additions:

1. `utterance.onstart` now also dispatches `concordia:dialogue-active` with `{ npcId }`
2. `utterance.onend` and `utterance.onerror` dispatch `concordia:dialogue-ended` with `{ npcId }`
3. New effect listens for `concordia:dialogue-barge-in` and calls the existing `cancelSpeech()`

The dependency array of the `speak` useCallback gained `npc.id` to satisfy the lint rule cleanly.

### `concord-frontend/components/world-lens/SoundscapeEngine.tsx`

Phase 15's combat-ducking effect grew two more listeners:

- `concordia:dialogue-active` → master gain ducks to 50% via `setTargetAtTime` over ~80ms
- `concordia:dialogue-ended` → master gain returns to baseline 0.6 over ~200ms

`baseline = 0.6` matches the existing `masterGain.gain.setValueAtTime(0.6, ctx.currentTime)` initialization, so the ramp-up lands exactly where the SoundscapeEngine started.

## Why no Piper migration in this phase

The full migration of `NPCDialogue.tsx` from `SpeechSynthesisUtterance` to streaming Piper audio is a substantial refactor:
- Fetch audio blob from `/api/voice/tts` macro
- Decode + queue + play through the existing Web Audio context (composes with HRTF / reverb)
- Re-implement mouth-animation polling against Web Audio buffer time instead of `speechSynthesis.speaking`
- Handle network failure → fall back to Web Speech API
- Load-balance Piper requests across the existing voice-pipeline.js capacity

That's a separate phase's worth of work, with its own surface area. Phase 16 ships the mix integration that Piper would need anyway, plus the barge-in plumbing. A future Phase 16b can swap the TTS engine without changing any callsites.

## Why no VAD-based auto-barge-in

True voice barge-in (player speaks → NPC pauses) needs:
- `getUserMedia` permission flow
- `AudioWorklet` energy-threshold processor
- Continuous mic stream during dialogue
- Privacy implications + UI consent

The window-event hook is in. A VAD module just dispatches `concordia:dialogue-barge-in` when it detects speech. Manual barge-in (UI button or keypress) works today by dispatching the same event. VAD is a deferred follow-up.

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint` — 1 pre-existing warning unrelated to this phase
- Manual verification (Phase 20):
  1. Open NPC dialogue → SFX volume drops noticeably during speech, returns on end
  2. Dispatch `concordia:dialogue-barge-in` from devtools while NPC is talking → speech cuts immediately and `dialogue-ended` fires (returning the mix)
  3. Hit something during dialogue → drone ducks (Phase 15) but doesn't double-duck the master (different gain nodes, both effects layer cleanly)

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world/NPCDialogue.tsx` | dispatch dialogue-active / -ended / barge-in handler |
| `concord-frontend/components/world-lens/SoundscapeEngine.tsx` | duck master gain on dialogue-active, restore on dialogue-ended |

## Block E complete

Phases 14, 15, 16 deliver:
- 14: spatial audio wired on death (rest of in-world deferred)
- 15: ambient ducking on combat
- 16: dialogue mix coordination + barge-in hook

Piper TTS migration and VAD-based auto-barge-in deferred and documented.
