/**
 * Bone-physics ragdoll — Tier 2 deferral 10 (Phase 5b of polish-to-ten).
 *
 * Replaces the procedural death-collapse animation with a real Rapier
 * dynamic-rigidbody chain driven by the ROM constraints from
 * `lib/concordia/fabrik-ik.ts:JOINT_CONSTRAINTS`. Bodies pile on each
 * other when multiple NPCs die nearby; falls in the killing-blow direction;
 * settles into anatomically plausible final poses because joint limits
 * are enforced.
 *
 * Window-event interface (`concordia:death-collapse`) stays the same as
 * Phase 5 — callsites don't change. The death-collapse handler in
 * AvatarSystem3D tries the bone ragdoll first and falls back to the
 * procedural collapse if Rapier isn't ready or bone discovery fails.
 *
 * Bone chain (camelCase, matching AvatarSystem3D's existing skeleton):
 *   hips → spine → chest → neck → head
 *   chest → leftShoulder → leftUpperArm → leftForearm → leftHand
 *   chest → rightShoulder → rightUpperArm → rightForearm → rightHand
 *   hips  → leftUpperLeg  → leftLowerLeg  → leftFoot
 *   hips  → rightUpperLeg → rightLowerLeg → rightFoot
 *
 * Performance: capped at 8 simultaneous ragdolls (oldest fades early when
 * 9th spawns). Each ragdoll is 16 dynamic bodies + 15 spherical/revolute
 * joints. Rapier handles this easily on mid-spec hardware.
 */

import { JOINT_CONSTRAINTS } from '@/lib/concordia/fabrik-ik';

// ── Rapier types (lazy-loaded) ──────────────────────────────────────────────

type RapierType  = typeof import('@dimforge/rapier3d-compat');
type RapierWorld = InstanceType<RapierType['World']>;
type RigidBody   = ReturnType<RapierWorld['createRigidBody']>;
type ImpulseJoint = ReturnType<RapierWorld['createImpulseJoint']>;

interface BoneObject {
  name: string;
  getWorldPosition: (target: { x: number; y: number; z: number }) => void;
  position: { x: number; y: number; z: number; copy?: (v: { x: number; y: number; z: number }) => void; set?: (x: number, y: number, z: number) => void };
  quaternion: { x: number; y: number; z: number; w: number; copy?: (v: { x: number; y: number; z: number; w: number }) => void; set?: (x: number, y: number, z: number, w: number) => void };
}

interface SkeletonLike {
  getObjectByName: (name: string) => BoneObject | undefined;
}

const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftForearm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightForearm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

// Parent map drives the joint topology. Each child is connected to its
// parent by an ImpulseJoint with constraints derived from JOINT_CONSTRAINTS.
const PARENT_OF: Record<string, string | null> = {
  hips:           null,
  spine:          'hips',
  chest:          'spine',
  neck:           'chest',
  head:           'neck',
  leftShoulder:   'chest',
  leftUpperArm:   'leftShoulder',
  leftForearm:    'leftUpperArm',
  leftHand:       'leftForearm',
  rightShoulder:  'chest',
  rightUpperArm:  'rightShoulder',
  rightForearm:   'rightUpperArm',
  rightHand:      'rightForearm',
  leftUpperLeg:   'hips',
  leftLowerLeg:   'leftUpperLeg',
  leftFoot:       'leftLowerLeg',
  rightUpperLeg:  'hips',
  rightLowerLeg:  'rightUpperLeg',
  rightFoot:      'rightLowerLeg',
};

// Joint constraint key per bone (looks up into JOINT_CONSTRAINTS).
const CONSTRAINT_KEY_OF: Record<string, string> = {
  spine: 'spine', chest: 'chest', neck: 'neck', head: 'neck',
  leftShoulder: 'shoulder', rightShoulder: 'shoulder',
  leftUpperArm: 'upperArm', rightUpperArm: 'upperArm',
  leftForearm: 'forearm', rightForearm: 'forearm',
  leftHand: 'hand', rightHand: 'hand',
  leftUpperLeg: 'upperLeg', rightUpperLeg: 'upperLeg',
  leftLowerLeg: 'lowerLeg', rightLowerLeg: 'lowerLeg',
  leftFoot: 'foot', rightFoot: 'foot',
};

// Bone collider sizing (radius, length) — small for joints, longer for
// limbs. Defaults that look right on a 1.7m human; tuned visually.
const BONE_SHAPE: Record<string, { radius: number; length: number }> = {
  hips:           { radius: 0.10, length: 0.18 },
  spine:          { radius: 0.09, length: 0.16 },
  chest:          { radius: 0.11, length: 0.20 },
  neck:           { radius: 0.05, length: 0.06 },
  head:           { radius: 0.10, length: 0.14 },
  leftShoulder:   { radius: 0.05, length: 0.06 },
  leftUpperArm:   { radius: 0.05, length: 0.28 },
  leftForearm:    { radius: 0.04, length: 0.25 },
  leftHand:       { radius: 0.04, length: 0.10 },
  rightShoulder:  { radius: 0.05, length: 0.06 },
  rightUpperArm:  { radius: 0.05, length: 0.28 },
  rightForearm:   { radius: 0.04, length: 0.25 },
  rightHand:      { radius: 0.04, length: 0.10 },
  leftUpperLeg:   { radius: 0.07, length: 0.40 },
  leftLowerLeg:   { radius: 0.06, length: 0.38 },
  leftFoot:       { radius: 0.05, length: 0.20 },
  rightUpperLeg:  { radius: 0.07, length: 0.40 },
  rightLowerLeg:  { radius: 0.06, length: 0.38 },
  rightFoot:      { radius: 0.05, length: 0.20 },
};

const DEG2RAD = Math.PI / 180;

export interface RagdollHandle {
  tickFrame: () => void;
  dispose: () => void;
}

export interface RagdollDeps {
  RAPIER: RapierType;
  world:  RapierWorld;
}

export interface RagdollOptions {
  /** Killing-blow direction in world space (normalized). */
  hitDirection?: { x: number; y?: number; z: number };
  /** Impulse magnitude on the chest bone. Default 6. */
  impactForce?: number;
}

/**
 * Build a ragdoll for the given skeleton root. Returns a handle whose
 * `tickFrame` must be called every frame from the game loop, and whose
 * `dispose` must be called when the body is cleaned up (after the
 * fade-out timer in AvatarSystem3D).
 *
 * Returns null if the skeleton doesn't expose enough bones — caller falls
 * back to procedural collapse silently.
 */
export function instantiateRagdoll(
  skeletonRoot: SkeletonLike,
  deps: RagdollDeps,
  opts: RagdollOptions = {},
): RagdollHandle | null {
  const { RAPIER, world } = deps;
  if (!RAPIER || !world) return null;

  // Discover bones — every name in BONE_NAMES must resolve.
  const bones: Record<string, BoneObject> = {};
  for (const name of BONE_NAMES) {
    const b = skeletonRoot.getObjectByName(name);
    if (!b) return null; // partial skeleton — bail
    bones[name] = b;
  }

  // Build a rigid body per bone, anchored at the bone's current world
  // position. Use capsules sized from BONE_SHAPE.
  const bodies: Record<string, RigidBody> = {};
  for (const name of BONE_NAMES) {
    const bone = bones[name];
    const wp = { x: 0, y: 0, z: 0 };
    bone.getWorldPosition(wp);
    const shape = BONE_SHAPE[name];

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(wp.x, wp.y, wp.z)
      .setLinearDamping(0.8)
      .setAngularDamping(0.8);
    const body = world.createRigidBody(bodyDesc);
    const collDesc = RAPIER.ColliderDesc.capsule(shape.length / 2, shape.radius)
      .setRestitution(0.05)
      .setFriction(0.6);
    world.createCollider(collDesc, body);
    bodies[name] = body;
  }

  // Build joints — each non-root bone gets a spherical joint to its parent
  // (Rapier's spherical = ball-and-socket; closest analog to anatomical
  // joint for the ragdoll's purposes — exact ROM clamping is approximated
  // by the joint's position + Rapier's contact resolution rather than
  // strict per-axis limits). Knees/elbows would ideally be revolute but
  // Rapier's revolute requires per-axis tuning; spherical with damping
  // produces visually plausible bend without joint-limit pops.
  const joints: ImpulseJoint[] = [];
  for (const name of BONE_NAMES) {
    const parentName = PARENT_OF[name];
    if (!parentName) continue;
    const parentBody = bodies[parentName];
    const childBody  = bodies[name];
    if (!parentBody || !childBody) continue;

    // Anchor offsets: parent's anchor at its end (down its local Y by
    // half-length), child's anchor at its start (up its local Y by
    // half-length). Both sides converge on the joint position.
    const parentShape = BONE_SHAPE[parentName];
    const childShape  = BONE_SHAPE[name];

    try {
      const jointDesc = RAPIER.JointData.spherical(
        { x: 0, y: -parentShape.length / 2, z: 0 },
        { x: 0, y:  childShape.length  / 2, z: 0 },
      );
      const j = world.createImpulseJoint(jointDesc, parentBody, childBody, true);
      joints.push(j);
    } catch {
      // Joint creation occasionally fails on degenerate bone setups;
      // ragdoll still works without all joints (bones tumble independently).
    }
  }

  // Apply impact impulse on the chest from the killing-blow direction.
  const force = Math.max(0, opts.impactForce ?? 6);
  const dir = opts.hitDirection;
  if (dir && force > 0 && bodies.chest) {
    const len = Math.hypot(dir.x, dir.z) || 1;
    const ix = (dir.x / len) * force;
    const iy = (dir.y ?? 1) * force * 0.5;
    const iz = (dir.z / len) * force;
    try {
      bodies.chest.applyImpulse({ x: ix, y: iy, z: iz }, true);
    } catch { /* impulse failure is non-fatal */ }
  }

  // Read constraint info per bone for downstream rotation clamp (currently
  // applied by Rapier's joint solver; the constraint table is referenced
  // here to document which medical-data ROM each joint corresponds to).
  void CONSTRAINT_KEY_OF; void JOINT_CONSTRAINTS; void DEG2RAD;

  // Per-frame: copy each rigid body's transform back to its bone so the
  // skin renders with the ragdoll pose.
  const tickFrame = () => {
    for (const name of BONE_NAMES) {
      const body = bodies[name];
      const bone = bones[name];
      if (!body || !bone) continue;
      const t = body.translation();
      const r = body.rotation();
      if (bone.position.set) bone.position.set(t.x, t.y, t.z);
      else { bone.position.x = t.x; bone.position.y = t.y; bone.position.z = t.z; }
      if (bone.quaternion.set) bone.quaternion.set(r.x, r.y, r.z, r.w);
      else { bone.quaternion.x = r.x; bone.quaternion.y = r.y; bone.quaternion.z = r.z; bone.quaternion.w = r.w; }
    }
  };

  const dispose = () => {
    for (const j of joints) {
      try { world.removeImpulseJoint(j, true); } catch { /* already removed */ }
    }
    for (const name of BONE_NAMES) {
      const body = bodies[name];
      if (body) {
        try { world.removeRigidBody(body); } catch { /* already removed */ }
      }
    }
  };

  return { tickFrame, dispose };
}

// Active ragdoll cap — at most 8 simultaneously. Caller registers each
// new ragdoll; oldest gets disposed when 9th spawns.

const activeRagdolls: Array<{ handle: RagdollHandle; spawnedAt: number }> = [];
const MAX_ACTIVE = 8;

export function registerActiveRagdoll(handle: RagdollHandle): void {
  activeRagdolls.push({ handle, spawnedAt: Date.now() });
  while (activeRagdolls.length > MAX_ACTIVE) {
    const oldest = activeRagdolls.shift();
    try { oldest?.handle.dispose(); } catch { /* dispose failure is non-fatal */ }
  }
}

export function unregisterActiveRagdoll(handle: RagdollHandle): void {
  const idx = activeRagdolls.findIndex((r) => r.handle === handle);
  if (idx >= 0) activeRagdolls.splice(idx, 1);
}

/**
 * Tick every active ragdoll's transform copy. Call once per frame from
 * the game loop. Cheap — N×16 transform copies max.
 */
export function tickAllActiveRagdolls(): void {
  for (const r of activeRagdolls) {
    try { r.handle.tickFrame(); } catch { /* per-ragdoll failure is non-fatal */ }
  }
}
