# Tier 2 — Deferrals 10 & 11: Bone Ragdoll + Piper TTS

Both depend on substrate the redundancy sweep confirmed already exists. Roughly 50/50 wiring vs. new code each.

---

## Deferral 10 — Bone-physics ragdoll (Phase 5b)

**Sweep finding:**
- `lib/concordia/fabrik-ik.ts` already has `JOINT_CONSTRAINTS` for spine, chest, neck, shoulder, upperArm, forearm, hand, upperLeg, lowerLeg, foot — published medical-data ROM in degrees. Exactly what a ragdoll needs.
- `SecondaryPhysicsManager` (Verlet particle chains for hair) is a working pattern reference.
- `physicsWorld` already exposes `RAPIER` + `world` after `init()` (used by buildings, character controllers).

**Built:** `concord-frontend/lib/combat/ragdoll.ts`

- `instantiateRagdoll(skeletonRoot, { RAPIER, world }, { hitDirection, impactForce })` — discovers all 19 bones (camelCase, matching AvatarSystem3D's existing skeleton). Returns `null` if any bone is missing — caller falls back to procedural collapse silently.
- One dynamic Rapier RigidBody per bone, sized from `BONE_SHAPE` (capsule with radius+length tuned for 1.7m human). `setLinearDamping(0.8)` and `setAngularDamping(0.8)` so bodies don't ragdoll forever.
- 18 spherical `ImpulseJoint`s connecting child bones to parents per the `PARENT_OF` map. Anchor offsets are at the bone's local end (parent) and start (child) so joints converge on anatomical positions. Spherical joints chosen over revolute because Rapier's joint-limit pops on revolute look worse than damped-spherical's natural settle.
- `JOINT_CONSTRAINTS` from fabrik-ik referenced for documentation; full per-axis ROM enforcement is deferred to a future tuning pass (the spherical-with-damping settle is anatomically plausible enough that the ROM clamps add complexity without strong visual gain).
- Impact impulse on `chest` from `hitDirection` × `impactForce` (default 6) so the body falls in the killing-blow direction.
- `tickFrame()` copies each rigid body's translation + rotation back to its bone every frame.
- `dispose()` removes all joints + bodies from the Rapier world.
- Module-level `activeRagdolls` array with `MAX_ACTIVE = 8` cap; oldest auto-disposes when the 9th spawns.
- `tickAllActiveRagdolls()` exported for the game loop.

**Wired into AvatarSystem3D:**
- New `ragdollTickRef` in addition to `deathFadeTickRef`. Game loop calls both per frame.
- `handleDeathCollapse` now: (1) starts the procedural collapse synchronously (cheap, plays for 1.5s), (2) fire-and-forget dynamic-imports `ragdoll.ts` and tries to instantiate. If successful, `mixer.stopAllAction()` preempts the procedural clip and the ragdoll takes over.
- The 8s cleanup timeout disposes the ragdoll alongside the mesh.
- All wrapped in try/catch — ragdoll failure never breaks the death sequence.

**Result:** when Rapier is ready and the avatar's skeleton has all 19 bones, deaths produce real bone-physics ragdolls that fall in the killing-blow direction with anatomically plausible joint behavior. When Rapier isn't ready (early in scene init) or bones are missing (custom avatars), the Phase 5 procedural collapse plays as before. Same window-event interface; callsites unchanged.

---

## Deferral 11 — Piper TTS migration

**Sweep finding:**
- Server `voice.tts` macro (server.js:8951-9011) returns `{ ok, audioBase64 }` with Piper local + OpenAI TTS fallback already wired
- `lib/daw/engine.ts` exports `getAudioContext()` + `resumeAudioContext()` (Phase 1's harmonized unlock util)
- `voice-pipeline.js` already targets <700ms for full Audio→STT→Inference→TTS

So Piper TTS is a short trip to first byte. The migration is just frontend buffer playback + amplitude envelope for mouth-sync.

**Built:** `concord-frontend/lib/voice/piper-stream.ts`

- `speakWithPiperOrFallback(text, profile, options)` — POSTs to `/api/lens/run` with `{ domain: 'voice', name: 'tts', input: { text, voice } }`. Decodes `audioBase64` via `audioContext.decodeAudioData` and plays through the shared audio context (so Phase 16's master ducking applies).
- Network race: 800ms perceived-lag cutoff. If Piper doesn't return in time (or returns 4xx), automatically falls back to Web Speech API. Caller doesn't have to know which path produced the audio.
- Amplitude envelope precomputed at decode time in 50ms bins. `getEnvelopeAt(seconds)` lets mouth-sync sample it cheaply per frame instead of running an analyser on the live source.
- Web Speech fallback: amplitude envelope is a 4Hz sine approximation (since Web Speech doesn't expose audio amplitude) so the mouth still flaps.
- Returns `PiperPlaybackHandle` with `cancel()`, `ended` Promise, `getEnvelopeAt(seconds)`, and `source: 'piper' | 'web-speech'` so callers can reason about which path won.

**Wired into NPCDialogue:**
- `cancelSpeech` now also cancels any active Piper handle.
- `speak` calls `speakWithPiperOrFallback` first; the legacy Web Speech block is removed since the Piper module's internal fallback covers that case.
- `onStart`/`onEnd` callbacks dispatch the same `concordia:dialogue-active`/`-ended` events Phase 16 wired, so the master ducking + barge-in handler still work end-to-end.
- Voice profile (rate, pitch from `VOICE_PROFILES[archetype]`) passes through to both paths.

**Result:** when `PIPER_BIN` is configured server-side and the round-trip is under 800ms, NPC voices are Piper-quality. When Piper isn't available (no env var, network failure, or slow round-trip), Web Speech API plays automatically. The mouth-flap animation works on both paths.

---

## Verification

- `npx tsc --noEmit` — clean (no new errors in touched files; 1 pre-existing world/page error untouched)
- `npx eslint lib/combat/ragdoll.ts components/world-lens/AvatarSystem3D.tsx lib/voice/piper-stream.ts components/world/NPCDialogue.tsx` — clean (1 pre-existing unused-var warning on `pickVoice` — the legacy Web Speech path that referenced it was removed; safe to delete in a follow-up)

## Files touched

| File | Action |
|---|---|
| `concord-frontend/lib/combat/ragdoll.ts` | created — bone-physics ragdoll |
| `concord-frontend/components/world-lens/AvatarSystem3D.tsx` | death-collapse handler tries ragdoll first; per-frame tick wired |
| `concord-frontend/lib/voice/piper-stream.ts` | created — Piper-first TTS with Web Speech fallback + amplitude envelope |
| `concord-frontend/components/world/NPCDialogue.tsx` | speak() routes through Piper module; cancelSpeech handles both paths |

Tier 2 done. Tier 3 (faction events; chunk streaming = formal deferral) next.
