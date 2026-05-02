# Phase 1 — Audio Init Harmonization

## Goal

Ensure every audio subsystem in the frontend handles `AudioContext` gesture-unlock identically, and that SFX requested before unlock are not silently lost.

## Pre-implementation discoveries

The Block A redundancy sweep changed the scope significantly:

- **`lib/music/player.ts:169-170`** already implements the `state === 'suspended'` → `resume()` pattern. The DAW engine had its own variant; SoundscapeEngine had a third (fire-and-forget). Three implementations, no shared util.
- **No existing `useAudioUnlock` hook** anywhere in 1.3M lines, so a shared module is justified.
- **No existing SFX queue / deferred playback** for SoundscapeEngine — an SFX requested before user gesture is lost (timing relative to `ctx.currentTime` is wrong even after resume).

## Changes

### New file: `concord-frontend/lib/audio/unlock.ts`

Single source of truth. Exports:

- `isAudioUnlocked(ctx)` — sync check, returns `true` only when `state === 'running'`
- `resumeAudioContext(ctx)` — async; idempotent; returns `boolean` indicating final running-or-not state
- `useAudioUnlock(ctx)` — React hook tracking ready state via `statechange` event listener

### `concord-frontend/lib/daw/engine.ts`

`resumeAudioContext()` (DAW-engine-local) now delegates to the shared util. The local `getAudioContext()` singleton stays unchanged.

```ts
import { resumeAudioContext as resumeCtx } from '../audio/unlock';

export async function resumeAudioContext(): Promise<void> {
  await resumeCtx(getAudioContext());
}
```

### `concord-frontend/components/world-lens/SoundscapeEngine.tsx`

Three modifications:

1. **`getOrCreateAudioContext`** now accepts an optional `onCreate` callback fired exactly once per fresh context. Resume is delegated to the shared util.
2. **New SFX queue** (`pendingSfxRef`) — when `triggerSFX` or `playSpatialSFX` is called and `ctx.state !== 'running'` (or context is null/missing), the request is queued with a timestamp.
3. **`flushPendingSfx`** is called from a `statechange` listener (registered once via the new `onCreate` hook). On unlock, queued SFX within the 2-second TTL are played; older entries are dropped (treated as stale). Queue is bounded at 32 entries to prevent unbounded growth.

## Verification

- `npx tsc --noEmit` — no new errors introduced (touched files clean)
- `npx eslint lib/audio/unlock.ts lib/daw/engine.ts components/world-lens/SoundscapeEngine.tsx` — 0 errors. The 1 warning is a pre-existing `react-hooks/exhaustive-deps` on line 259 outside the edit range.
- Manual verification (deferred to Phase 20 end-to-end): cold-load world lens, click any UI element, confirm SFX from rapid early clicks is no longer silently lost; cold-load studio lens, confirm metronome plays on first hit without console errors.

## Files touched

| File | Lines | Action |
|---|---|---|
| `concord-frontend/lib/audio/unlock.ts` | 47 | created |
| `concord-frontend/lib/daw/engine.ts` | 18–32 | refactored |
| `concord-frontend/components/world-lens/SoundscapeEngine.tsx` | 1–4, 184–197, 268–311, 408–429 | extended |

## Why this is enough for the dimension

The audit rated audio 3/10. Phase 1 alone doesn't lift the rating — Phases 14 (spatial audio wiring) and 15 (dynamic mixing) carry the bulk. But Phase 1 is the foundation: if context unlock is unreliable, every subsequent audio improvement plays into a coin-flip of "did the gesture happen yet?"

## Notes for downstream phases

- Phase 14 (spatial audio wiring) can rely on this queue: as it migrates callsites from `triggerSFX` → `playSpatialSFX`, the queue handles spatial coordinates correctly via the `spatial?: { x, y, z }` field already in the queue entry shape.
- Phase 16 (voice barge-in) can use `useAudioUnlock(ctx)` to wait for unlock before activating VAD streams.
