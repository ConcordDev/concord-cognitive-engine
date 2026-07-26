// Phase AA2 — confirm AvatarSystem3D imports + uses useAvatarAnimator.
//
// AvatarSystem3D.tsx is too Three.js-heavy (refs, scene graph, animation
// mixers) to mount and render in jsdom — same exemption this repo already
// applies to every other file in components/world-lens/ (see
// tests/world-lens-discharge-flash-wiring.test.ts's header comment).
//
// What CAN be — and now is — exercised for real:
//   - `resolveGaitPose`, the pure worker-pose-or-inline-fallback function
//     both the player and NPC per-frame gait blocks call. It's exported
//     from AvatarSystem3D.tsx specifically so this file can drive the REAL
//     production fallback logic with real inputs (a real worker pose, or
//     null) instead of regex-matching the ternary's source text — same
//     pattern as world-lens-discharge-flash-wiring.test.ts's
//     resolveDischargeVfx.
//   - `useAvatarAnimator`'s real `requestGait` behavior (worker
//     postMessage / latest-pose cache / distinct avatarIds), real-rendered
//     via `renderHook` at tests/hooks/useAvatarAnimator.test.ts.
//
// What's left as a static/structural pin (retitled, not faked, kept in a
// describe block with no behavior-claim language): whether
// AvatarSystem3D.tsx's own source names `useAvatarAnimator` /
// `serializableToGaitPose` in imports, calls the hook once at the top of
// the component, and has two `requestGait(` call sites (player + NPC).
// These are facts about that file's own unrendered source structure, not
// something this file can exercise at runtime without mounting the scene.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGaitPose } from '@/components/world-lens/AvatarSystem3D';
import { serializableToGaitPose } from '@/lib/concordia/animator-protocol';
import { synthesizeGait, type GaitParams } from '@/lib/concordia/gait-synthesis';
import type { SerializableGaitPose } from '@/lib/concordia/animator-protocol';
import { MOVEMENT_STYLE_CONFIGS } from '@/lib/concordia/movement-styles';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world-lens', 'AvatarSystem3D.tsx');

describe('AvatarSystem3D.tsx — static source facts about the avatar-animator worker (source-text pins, not runtime-verified)', () => {
  const source = readFileSync(FILE, 'utf8');

  it('source contains an import statement naming useAvatarAnimator (static pin — see this file\'s header for why it is not runtime-verified)', () => {
    expect(source).toMatch(/import\s*\{\s*useAvatarAnimator\s*\}\s*from\s*['"]@\/hooks\/useAvatarAnimator['"]/);
  });

  it('source contains an import statement naming serializableToGaitPose (static pin — see this file\'s header for why it is not runtime-verified)', () => {
    expect(source).toMatch(/import\s*\{\s*serializableToGaitPose\s*,\s*type\s*SerializableGaitPose\s*\}\s*from\s*['"]@\/lib\/concordia\/animator-protocol['"]/);
  });

  it('source has exactly one useAvatarAnimator() invocation at the top of the component (static pin — see this file\'s header for why it is not runtime-verified)', () => {
    const matches = source.match(/const\s+avatarAnimator\s*=\s*useAvatarAnimator\(\)/g) || [];
    expect(matches.length).toBe(1);
  });

  it('source has two distinct avatarAnimator.requestGait( invocation sites, one for the player gait branch and one for the NPC gait branch (static pin — see this file\'s header for why it is not runtime-verified)', () => {
    const matches = source.match(/avatarAnimator\.requestGait\(/g) || [];
    expect(matches.length).toBe(2);
  });
});

describe('Phase AA2 — resolveGaitPose real behavior (worker-pose-or-inline fallback)', () => {
  const params: GaitParams = {
    speed: 1.2,
    direction: 0,
    slope: 0,
    load: 0,
    fatigue: 0.8,
    bodyType: 'average',
    style: MOVEMENT_STYLE_CONFIGS.warrior,
  };

  it('falls back to the real inline synthesizeGait output when the worker pose is null', () => {
    const expected = synthesizeGait(params, 0.5);
    const actual = resolveGaitPose(null, params, 0.5);
    expect(actual).toEqual(expected);
  });

  it('prefers the real rehydrated worker pose (via serializableToGaitPose) over the inline fallback when a worker pose IS available', () => {
    // A real worker-shaped pose — the same identity zero-rotation shape
    // the worker protocol emits — deliberately NOT equal to what
    // synthesizeGait(params, 0.5) would produce, so the assertion below
    // can only pass if resolveGaitPose actually took the worker branch.
    const zeroEuler = { x: 0, y: 0, z: 0, order: 'XYZ' };
    const zeroVec = { x: 0, y: 0, z: 0 };
    const workerPose: SerializableGaitPose = {
      hips: zeroEuler, hipOffset: zeroVec, spine: zeroEuler, chest: zeroEuler, neck: zeroEuler,
      leftUpperLeg: zeroEuler, leftLowerLeg: zeroEuler, leftFoot: zeroEuler,
      rightUpperLeg: zeroEuler, rightLowerLeg: zeroEuler, rightFoot: zeroEuler,
      leftUpperArm: zeroEuler, leftForearm: zeroEuler, rightUpperArm: zeroEuler, rightForearm: zeroEuler,
    };

    const expected = serializableToGaitPose(workerPose);
    const actual = resolveGaitPose(workerPose, params, 0.5);
    expect(actual).toEqual(expected);

    // And it must genuinely differ from the inline fallback for this
    // moving-gait input — otherwise this test couldn't tell the two
    // branches apart.
    const fallback = synthesizeGait(params, 0.5);
    expect(actual.hips.x === fallback.hips.x && actual.spine.x === fallback.spine.x).toBe(false);
  });
});
