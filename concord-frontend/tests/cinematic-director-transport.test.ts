/**
 * Cinematic director transport (Q56 remainder) — the director's shot
 * clock used to be a bare setTimeout chain: no pause, no seek, and the
 * CameraControls skip buttons were honestly disabled for lack of an
 * API. These tests pin the transport that replaced it: pause freezes
 * the playback position exactly, resume continues it, seek lands on
 * the target shot and re-applies it, skip moves by shot boundaries,
 * and cancel resolves a paused sequence (no deadlock against the
 * frozen clock).
 *
 * Real timers with short authored shots (80ms) — the director polls
 * its clock every 25ms, so boundaries land within a tick; assertions
 * use ranges except the paused position, which is exact by
 * construction (a paused clock does not advance).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  registerSequence,
  playSequence,
  isCinematicActive,
  getPlaybackState,
  pauseActiveSequence,
  resumeActiveSequence,
  seekActiveSequence,
  skipActiveShot,
  cancelActiveSequence,
  type CinematicSequence,
} from '@/lib/world-lens/cinematic-director';

let seqCounter = 0;
function makeSequence(): CinematicSequence {
  seqCounter += 1;
  const id = `test:transport-${seqCounter}`;
  return {
    id,
    trigger: id,
    lockInput: false,
    duration_ms: 240,
    skippable_after_ms: 0,
    shots: [
      { camera: 'close_on', duration_ms: 80 },
      { camera: 'pull_back', duration_ms: 80 },
      { camera: 'whip_pan', duration_ms: 80 },
    ],
  };
}

async function settleInactive() {
  cancelActiveSequence();
  await vi.waitFor(() => expect(isCinematicActive()).toBe(false), { timeout: 2000 });
}

afterEach(async () => {
  await settleInactive();
});

describe('cinematic-director transport', () => {
  it('reports playback state and advances shots while playing', async () => {
    const seq = makeSequence();
    registerSequence(seq);
    void playSequence(seq.trigger);
    const s0 = getPlaybackState();
    expect(s0).not.toBeNull();
    expect(s0?.durationMs).toBe(240);
    expect(s0?.shotCount).toBe(3);
    expect(s0?.currentShot).toBe(0);
    expect(s0?.paused).toBe(false);
    await vi.waitFor(() => expect(getPlaybackState()?.currentShot).toBe(1), { timeout: 2000 });
  });

  it('pause freezes the position exactly; resume continues to the end', async () => {
    const seq = makeSequence();
    registerSequence(seq);
    const done = playSequence(seq.trigger);
    pauseActiveSequence();
    const frozen = getPlaybackState();
    expect(frozen?.paused).toBe(true);
    const frozenElapsed = frozen?.elapsedMs ?? -1;
    // Unpaused, 200ms would cross two shot boundaries.
    await new Promise((r) => setTimeout(r, 200));
    const still = getPlaybackState();
    expect(still?.paused).toBe(true);
    expect(still?.currentShot).toBe(0);
    expect(still?.elapsedMs).toBe(frozenElapsed);
    resumeActiveSequence();
    expect(getPlaybackState()?.paused).toBe(false);
    await done;
    expect(isCinematicActive()).toBe(false);
  });

  it('seek lands on the target shot and re-applies it', async () => {
    const seq = makeSequence();
    registerSequence(seq);
    const shotEvents: number[] = [];
    const onShot = (e: Event) => {
      shotEvents.push((e as CustomEvent).detail.shotIndex as number);
    };
    window.addEventListener('concordia:cinematic-shot', onShot);
    try {
      void playSequence(seq.trigger);
      seekActiveSequence(170);
      await vi.waitFor(() => expect(getPlaybackState()?.currentShot).toBe(2), { timeout: 2000 });
      const s = getPlaybackState();
      expect(s?.elapsedMs).toBeGreaterThanOrEqual(160);
      expect(s?.elapsedMs).toBeLessThanOrEqual(240);
      // The target shot's state was re-dispatched after the seek.
      expect(shotEvents.filter((i) => i === 2).length).toBeGreaterThanOrEqual(1);
    } finally {
      window.removeEventListener('concordia:cinematic-shot', onShot);
    }
  });

  it('skip moves by shot boundaries in both directions', async () => {
    const seq = makeSequence();
    registerSequence(seq);
    void playSequence(seq.trigger);
    skipActiveShot(1);
    await vi.waitFor(() => expect(getPlaybackState()?.currentShot).toBe(1), { timeout: 2000 });
    skipActiveShot(-1);
    await vi.waitFor(() => expect(getPlaybackState()?.currentShot).toBe(0), { timeout: 2000 });
  });

  it('seek works while paused and playback stays frozen at the new position', async () => {
    const seq = makeSequence();
    registerSequence(seq);
    void playSequence(seq.trigger);
    pauseActiveSequence();
    seekActiveSequence(90);
    await vi.waitFor(() => expect(getPlaybackState()?.currentShot).toBe(1), { timeout: 2000 });
    const s = getPlaybackState();
    expect(s?.paused).toBe(true);
    expect(s?.elapsedMs).toBe(90);
  });

  it('cancel resolves a paused sequence instead of deadlocking', async () => {
    const seq = makeSequence();
    registerSequence(seq);
    const done = playSequence(seq.trigger);
    pauseActiveSequence();
    cancelActiveSequence();
    await done;
    expect(isCinematicActive()).toBe(false);
    expect(getPlaybackState()).toBeNull();
  });
});
