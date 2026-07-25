// Real behavioral coverage for useAvatarAnimator (Phase AA2/E) — independent
// of AvatarSystem3D, which is too Three.js-heavy to mount in jsdom (see
// tests/avatar-system-worker-wired.test.tsx's header for that exemption +
// how it covers AvatarSystem3D's own fallback wiring via the extracted
// resolveGaitPose pure function instead). This file drives the REAL hook
// via renderHook against a mocked `Worker` global, proving requestGait
// actually posts to the worker and returns the latest cached pose once one
// arrives — not a regex match against source text.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAvatarAnimator } from '@/hooks/useAvatarAnimator';
import type { WorkerOutbound } from '@/lib/concordia/animator-protocol';

class MockWorker {
  static instances: MockWorker[] = [];
  listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
  posted: unknown[] = [];
  constructor(_url: URL, _opts?: unknown) {
    MockWorker.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener(type: string, cb: (ev: MessageEvent) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter((c) => c !== cb);
  }
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {}
  // test helper — simulates the worker thread emitting a real message event
  emit(data: WorkerOutbound) {
    for (const cb of this.listeners['message'] || []) cb({ data } as MessageEvent);
  }
}

describe('useAvatarAnimator', () => {
  beforeEach(() => {
    MockWorker.instances.length = 0;
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('spawns a real Worker on mount and posts a real "animate" message when requestGait is called', () => {
    const { result } = renderHook(() => useAvatarAnimator());
    expect(MockWorker.instances).toHaveLength(1);
    const worker = MockWorker.instances[0];

    act(() => {
      worker.emit({ type: 'ready' });
    });

    const params = {
      speed: 1, direction: 0, slope: 0, load: 0, fatigue: 1,
      bodyType: 'average' as const,
      style: { walkCycleSpeed: 1, strideLengthScale: 1, hipSwayAmplitude: 0.05, armSwingAmplitude: 0.2, headBobFrequency: 1, combatStanceOffset: 0, turnAnimationBlend: 0.5, idleBreathScale: 0.8, dodgeStyle: 'roll' as const },
    };

    act(() => {
      result.current.requestGait('avatar-1', params, 0.5, 0.016);
    });

    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({ type: 'animate', avatarId: 'avatar-1', phase: 0.5 });
  });

  it('caches the latest pose per avatarId and returns it on the NEXT requestGait call for that avatar (real one-frame-stale contract)', () => {
    const { result } = renderHook(() => useAvatarAnimator());
    const worker = MockWorker.instances[0];
    act(() => { worker.emit({ type: 'ready' }); });

    const params = {
      speed: 1, direction: 0, slope: 0, load: 0, fatigue: 1,
      bodyType: 'average' as const,
      style: { walkCycleSpeed: 1, strideLengthScale: 1, hipSwayAmplitude: 0.05, armSwingAmplitude: 0.2, headBobFrequency: 1, combatStanceOffset: 0, turnAnimationBlend: 0.5, idleBreathScale: 0.8, dodgeStyle: 'roll' as const },
    };

    // First call: no pose cached yet for 'avatar-1'.
    let first: unknown;
    act(() => { first = result.current.requestGait('avatar-1', params, 0.0, 0.016); });
    expect(first).toBeNull();

    // Worker "computes" and reports back a pose for frame 1.
    const zeroEuler = { x: 0.1, y: 0, z: 0, order: 'XYZ' };
    const zeroVec = { x: 0, y: 0, z: 0 };
    const fakePose = {
      hips: zeroEuler, hipOffset: zeroVec, spine: zeroEuler, chest: zeroEuler, neck: zeroEuler,
      leftUpperLeg: zeroEuler, leftLowerLeg: zeroEuler, leftFoot: zeroEuler,
      rightUpperLeg: zeroEuler, rightLowerLeg: zeroEuler, rightFoot: zeroEuler,
      leftUpperArm: zeroEuler, leftForearm: zeroEuler, rightUpperArm: zeroEuler, rightForearm: zeroEuler,
    };
    act(() => {
      worker.emit({ type: 'animate-result', avatarId: 'avatar-1', frameId: 1, pose: fakePose, computeMs: 2 });
    });

    // Second call for the SAME avatar now returns the real cached pose.
    let second: unknown;
    act(() => { second = result.current.requestGait('avatar-1', params, 0.1, 0.016); });
    expect(second).toEqual(fakePose);

    // A DIFFERENT avatarId has no cached pose of its own — proves the cache
    // is genuinely keyed per-avatar, not a single shared slot.
    let npc: unknown;
    act(() => { npc = result.current.requestGait('npc:goblin-1', params, 0.1, 0.016); });
    expect(npc).toBeNull();
  });

  it('returns null and never throws when the worker has not signalled ready yet', () => {
    const { result } = renderHook(() => useAvatarAnimator());
    const params = {
      speed: 1, direction: 0, slope: 0, load: 0, fatigue: 1,
      bodyType: 'average' as const,
      style: { walkCycleSpeed: 1, strideLengthScale: 1, hipSwayAmplitude: 0.05, armSwingAmplitude: 0.2, headBobFrequency: 1, combatStanceOffset: 0, turnAnimationBlend: 0.5, idleBreathScale: 0.8, dodgeStyle: 'roll' as const },
    };
    let pose: unknown;
    expect(() => {
      act(() => { pose = result.current.requestGait('avatar-1', params, 0, 0.016); });
    }).not.toThrow();
    expect(pose).toBeNull();
  });
});
