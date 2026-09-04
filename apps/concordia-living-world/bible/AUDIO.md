# AUDIO

**Status:** PARTIAL / BROKEN  
**Authority:** Unity presentation · Concord state (when to play)  
**Source:** `src/game/audio.ts`; Unity `WorldBuilder.DressAudio`; `Footsteps.cs`

## LIVE

Browser: WebAudio bus (master/sfx/music), mute. Unity: `AudioSource` footsteps; DressAudio looks for `Assets/Audio/Background_Music_*.prefab` — **not present** in the Unity Assets tree this audit.

Vrellan Six: **MISSING**.

## TARGET

Layers: ambient, weather, wildlife, settlements, combat, abilities, dialogue, UI, music. Mix from world + time + weather + faction + danger.

## Gap

Do not claim a score until files exist and play.
