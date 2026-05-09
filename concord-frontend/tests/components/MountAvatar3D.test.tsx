/**
 * MountAvatar3D contract — pure-helper assertions.
 *
 * The renderer itself runs inside react-three-fiber, which would need
 * a WebGL stub to instantiate. Instead this test exercises the two
 * exported helpers (computeSaddleAnchor + gaitBlockFor) which carry
 * the load-bearing math; the visual behavior is exercised in the
 * Storybook + manual playtest path.
 */

import { describe, it, expect } from 'vitest';
import {
  computeSaddleAnchor,
  gaitBlockFor,
} from '@/components/concordia/mounts/MountAvatar3D';
import type {
  MountSpecies,
  MountGaitProfile,
  MountedFrame,
} from '@/lib/concordia/mounts/mount-types';

const SPECIES: MountSpecies = {
  speciesId: 'horse',
  displayName: 'Horse',
  sizeClass: 'medium',
  baseSpeedMps: 6,
  baseStamina: 100,
  carryCapacityKg: 100,
  gaitProfileId: 'gait_horse',
  riderSeatOffset: { x: 0, y: 1.2, z: 0, yaw: 0 },
  saddleAnchorBone: 'spine_03',
  reinsAnchorBone: 'head',
  flightCapable: false,
  aestheticTags: ['mammal', 'land'],
};

const GAIT: MountGaitProfile = {
  id: 'gait_horse',
  speciesId: 'horse',
  walk:    { phase_offsets: [0,    0.5,  0.25, 0.75], stride_m: 0.6, ground_clearance_m: 0.10 },
  trot:    { phase_offsets: [0,    0.5,  0.5,  0   ], stride_m: 1.0, ground_clearance_m: 0.20 },
  gallop:  { phase_offsets: [0,    0.1,  0.5,  0.6 ], stride_m: 2.5, ground_clearance_m: 0.45 },
  turnRadiusM: 5,
};

const FRAME: MountedFrame = {
  mountPos: { x: 10, y: 0, z: 5 },
  mountYaw: 0,
  speed: 4.0,
  gaitPhase: 0.25,
  gaitMode: 'trot',
};

describe('computeSaddleAnchor', () => {
  it('places saddle at mount position + offset for yaw=0', () => {
    const anchor = computeSaddleAnchor(SPECIES, FRAME);
    expect(anchor.x).toBeCloseTo(10);
    expect(anchor.y).toBeCloseTo(1.2);
    expect(anchor.z).toBeCloseTo(5);
    expect(anchor.yaw).toBeCloseTo(0);
  });

  it('rotates offset by mount yaw (yaw=π/2 → +x offset becomes +z)', () => {
    const offsetSpecies: MountSpecies = {
      ...SPECIES,
      riderSeatOffset: { x: 1.0, y: 1.0, z: 0, yaw: 0 },
    };
    const yawedFrame: MountedFrame = { ...FRAME, mountYaw: Math.PI / 2 };
    const anchor = computeSaddleAnchor(offsetSpecies, yawedFrame);
    // yaw=π/2: cos=0, sin=1. x' = px + off.x*0 - off.z*1 = 10 + 0 = 10
    //                       z' = pz + off.x*1 + off.z*0 = 5 + 1 = 6
    expect(anchor.x).toBeCloseTo(10);
    expect(anchor.z).toBeCloseTo(6);
  });

  it('combines yaw offset with mount yaw', () => {
    const seatedSpecies: MountSpecies = {
      ...SPECIES,
      riderSeatOffset: { x: 0, y: 1.0, z: 0, yaw: 0.2 },
    };
    const anchor = computeSaddleAnchor(seatedSpecies, { ...FRAME, mountYaw: 1.0 });
    expect(anchor.yaw).toBeCloseTo(1.2);
  });
});

describe('gaitBlockFor', () => {
  it('returns walk block for walk mode', () => {
    expect(gaitBlockFor(GAIT, 'walk').phase_offsets).toEqual([0, 0.5, 0.25, 0.75]);
  });

  it('returns trot block for trot mode', () => {
    expect(gaitBlockFor(GAIT, 'trot').phase_offsets).toEqual([0, 0.5, 0.5, 0]);
  });

  it('returns gallop block for gallop AND canter (substrate convention)', () => {
    expect(gaitBlockFor(GAIT, 'gallop').phase_offsets).toEqual([0, 0.1, 0.5, 0.6]);
    expect(gaitBlockFor(GAIT, 'canter').phase_offsets).toEqual([0, 0.1, 0.5, 0.6]);
  });

  it('returns the right stride/clearance for trot vs gallop', () => {
    expect(gaitBlockFor(GAIT, 'trot').stride_m).toBe(1.0);
    expect(gaitBlockFor(GAIT, 'gallop').stride_m).toBe(2.5);
    expect(gaitBlockFor(GAIT, 'trot').ground_clearance_m).toBe(0.20);
    expect(gaitBlockFor(GAIT, 'gallop').ground_clearance_m).toBe(0.45);
  });
});
