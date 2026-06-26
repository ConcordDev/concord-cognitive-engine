/**
 * PhysicsWorld — singleton Rapier.js wrapper for Concordia.
 *
 * Responsibilities:
 *  - One Rapier.World with gravity (-9.81 Y)
 *  - Heightfield collider for terrain (registered once at scene init)
 *  - Box colliders for buildings (static, registered per building)
 *  - Kinematic character controllers for player + NPCs (capsule)
 *  - step(dt) advances the simulation each game-loop frame
 */

import { canJump, shouldFlushBuffer, cutJump } from './jump-forgiveness';
import { bakeDeltasIntoHeightmap } from './terrain-deform-math';
import {
  type TraversalState, freshTraversalState, beginDash, dashVelocityAt, isInvulnerable as tkInvulnerable,
} from '../concordia/traversal-kinematics';

type RapierType = typeof import('@dimforge/rapier3d-compat');
type WorldType   = InstanceType<RapierType['World']>;
type CharCtrl    = ReturnType<WorldType['createCharacterController']>;
type RigidBody   = ReturnType<WorldType['createRigidBody']>;
type Collider    = ReturnType<WorldType['createCollider']>;

type ThreeType = typeof import('three');
type Object3DLike = {
  userData?: Record<string, unknown>;
  traverse?: (cb: (child: Object3DLike) => void) => void;
};

export interface CharacterMoveResult {
  x: number;
  y: number;
  z: number;
}

interface RagdollSegment {
  name:    string;
  halfH:   number;
  radius:  number;
  parentIdx: number;
  anchorParent: { x: number; y: number; z: number };
  anchorChild:  { x: number; y: number; z: number };
}

export interface RagdollHandle {
  id:    string;
  bodies: RigidBody[];
  segmentNames: string[];
  spawnedAt: number;
}

// Theme 5/6 (game-feel pass): per-controller kinematic state. Lives outside
// the Rapier capsule so we can integrate manual velocities (knockback,
// jump, glide) into moveCharacter without migrating the player to a
// dynamic body. Kinematic bodies don't accept applyImpulse / setLinvel
// — those are silent no-ops on this controller type.
interface KinematicState {
  /** Active knockback velocity in world space (m/s). Decays linearly to 0
   *  by expiresAt; capped per-axis so total displacement ≤ MAX_KB_M. */
  kbVx: number;
  kbVz: number;
  kbStartedAt: number;
  kbExpiresAt: number;
  /** Total displacement so far from the current knockback impulse. */
  kbTravelled: number;
  // Theme 6 (game-feel pass): vertical kinematics for jump / glide / swim.
  /** Vertical velocity in m/s; positive is up. */
  verticalVel: number;
  /** True while NOT in steady contact with terrain (during a jump/fall). */
  isAirborne: boolean;
  /** Wall-clock ms until snap-to-ground re-enables. Suppresses the
   *  built-in 0.5m snap during jumps so we actually leave the ground. */
  snapDisabledUntil: number;
  /** Glide active (held Space mid-air). Clamps descent + adds horizontal
   *  forward bias to feel like a slow-fall sail rather than a parachute. */
  gliding: boolean;
  /** Swim active (capsule below water-line for current world). */
  swimming: boolean;
  // B1 — movement forgiveness layer.
  /** Wall-clock ms of the last ground contact (coyote-time source). */
  lastGroundedAt: number;
  /** Wall-clock ms of a jump requested while airborne (jump-buffer; 0 = none). */
  jumpBufferedAt: number;
  /** Pending buffered jump velocity. */
  jumpVyPending: number;
}

const MAX_KB_M = 1.5;       // total knockback displacement cap (metres)
const KB_DEFAULT_MS = 220;  // default knockback duration
const JUMP_DEFAULT_VY = 7.5; // m/s — clears ~2.8m peak (with 9.81 g)
const GRAVITY = 9.81;
const GLIDE_DESCENT_CAP = -1.5;  // m/s; can't fall faster than this while gliding
const GLIDE_HORIZ_BOOST = 0.08;  // +8% horizontal during glide
const SWIM_BUOYANCY = 4.5;       // m/s upward force gradient toward surface
const SWIM_GRAVITY  = 1.2;       // reduced gravity while submerged

class PhysicsWorld {
  private RAPIER: RapierType | null         = null;
  private THREE:  ThreeType | null          = null;
  private world:  WorldType | null          = null;
  private controllers: Map<string, CharCtrl>  = new Map();
  private bodies:      Map<string, RigidBody>  = new Map();
  private colliders:   Map<string, Collider>   = new Map();
  private kinematic:   Map<string, KinematicState> = new Map();
  // Part B — per-entity traversal state (dash burst + i-frames + slide). Kept
  // parallel to KinematicState; folded into moveCharacter like knockback.
  private traversal:   Map<string, TraversalState> = new Map();
  // WS-A2 — the terrain heightfield collider handle + its source heightmap, so
  // deformations can SWAP it (Rapier heightfields are immutable: removeCollider
  // + createCollider). _terrainHmData is the pristine base (normalized 0..1);
  // rebuildHeightfieldWithDeltas bakes deltas into a copy and re-creates.
  private _terrainCollider: Collider | null = null;
  private _terrainHmData: Float32Array | null = null;
  private _terrainHmW = 0;
  private _terrainHmH = 0;
  private _terrainScale: { x: number; y: number; z: number } = { x: 2000, y: 80, z: 2000 };
  // Re-entrancy guard. Rapier's WASM bindings panic ("recursive use of an
  // object detected which would lead to unsafe aliasing in rust") if JS
  // re-enters the world while another method is still executing on it —
  // e.g. a synchronous event dispatched from inside step() that lands in
  // an AvatarSystem3D handler calling knockbackKinematic. JS is single-
  // threaded but Rapier's borrow check fires on logical recursion. Guard
  // every world-touching method: if another op is in flight, skip safely
  // and return a no-op fallback rather than crash the scene.
  private _inOp: boolean = false;
  // _ready gates every WASM-touching method on a fully-initialised world.
  // Set true at the end of init() (after every await resolves), set false
  // at the start of destroy() and after any unrecoverable internal panic.
  // Without this gate, RAF can call step() between the RAPIER.init() await
  // and the THREE import — exercising a half-initialised world and
  // tripping wasm-bindgen's borrow check repeatedly.
  private _ready: boolean = false;
  private _guard<T>(label: string, fn: () => T, fallback: T): T {
    if (!this._ready) return fallback;
    if (this._inOp) {
      if (typeof console !== 'undefined') {
        console.warn(`[physicsWorld] reentrancy: ${label} skipped (another op in flight)`);
      }
      return fallback;
    }
    this._inOp = true;
    try { return fn(); }
    finally { this._inOp = false; }
  }

  /** Load Rapier WASM and create the physics world. Call once at scene startup. */
  async init(): Promise<void> {
    if (this.world && this._ready) return;
    // Allow re-init after destroy(): React strict-mode / route changes can
    // unmount → remount the world host; the singleton's _destroyed flag
    // was permanently stuck true post-destroy(), which is fine for the
    // destroy guard itself but blocks a clean re-init. Reset it here so a
    // second mount gets a fresh, working world instead of a half-state.
    this._destroyed = false;
    this._inOp = false;
    const RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();
    this.RAPIER = RAPIER;
    this.world  = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // Pre-load THREE so building registration can compute bounding boxes synchronously.
    this.THREE = await import('three');
    // Mark ready ONLY after every await has resolved. step() and the rest
    // gate on this — without it, RAF could fire step() between the
    // RAPIER.init() await and THREE.import() await, exercising a
    // half-initialised world and tripping wasm-bindgen's borrow check.
    this._ready = true;
  }

  /** Advance physics simulation by dt seconds. Call every game-loop frame. */
  step(dt: number): void {
    this._guard('step', () => {
      if (!this.world) return;
      this.world.timestep = Math.min(dt, 0.05); // cap at 50ms
      this.world.step();
    }, undefined);
  }

  /**
   * Register the terrain as a Rapier heightfield collider.
   * hmData: Float32Array of normalized heights (0..1), row-major.
   * width/height: number of columns/rows in the heightmap.
   * worldScale: { x, y, z } — maps heightmap cell to world metres.
   */
  createHeightfieldCollider(
    hmData: Float32Array,
    hmWidth: number,
    hmHeight: number,
    worldScale: { x: number; y: number; z: number },
  ): void {
    this._guard('createHeightfieldCollider', () => {
      if (!this.RAPIER || !this.world) return;
      const RAPIER = this.RAPIER;
      const desc = RAPIER.ColliderDesc.heightfield(
        hmHeight - 1,
        hmWidth  - 1,
        hmData,
        { x: worldScale.x, y: worldScale.y, z: worldScale.z },
      );
      desc.setTranslation(0, 0, 0);
      // WS-A2 — keep the handle + a pristine copy of the source heightmap so the
      // terrain can be deformed later via removeCollider + re-create.
      this._terrainCollider = this.world.createCollider(desc);
      this._terrainHmData = new Float32Array(hmData);
      this._terrainHmW = hmWidth;
      this._terrainHmH = hmHeight;
      this._terrainScale = { x: worldScale.x, y: worldScale.y, z: worldScale.z };
    }, undefined);
  }

  /**
   * WS-A2 — deform the terrain collider to match server deformations. Bakes the
   * per-cell height deltas (metres, keyed "cx,cz") into a copy of the pristine
   * base heightmap, removes the current heightfield collider, and creates a new
   * one. Rapier heightfields are immutable, so this swap is the only path.
   *
   * CALLER MUST DEBOUNCE — collider recreate is the expensive op; never call
   * per-frame. No-op until a base heightfield has been registered.
   */
  rebuildHeightfieldWithDeltas(cellDeltas: Map<string, number>, cellSize = 10, maxElev?: number): void {
    this._guard('rebuildHeightfieldWithDeltas', () => {
      if (!this.RAPIER || !this.world || !this._terrainHmData) return;
      const RAPIER = this.RAPIER;
      const elev = Number.isFinite(maxElev as number) ? (maxElev as number) : this._terrainScale.y;
      const baked = bakeDeltasIntoHeightmap(
        this._terrainHmData, this._terrainHmW, this._terrainHmH,
        cellDeltas, cellSize, elev, this._terrainScale.x,
      );
      // Remove the old heightfield, then create the deformed one.
      if (this._terrainCollider) {
        try { this.world.removeCollider(this._terrainCollider, false); } catch { /* already gone */ }
        this._terrainCollider = null;
      }
      const desc = RAPIER.ColliderDesc.heightfield(
        this._terrainHmH - 1,
        this._terrainHmW - 1,
        baked,
        { x: this._terrainScale.x, y: this._terrainScale.y, z: this._terrainScale.z },
      );
      desc.setTranslation(0, 0, 0);
      this._terrainCollider = this.world.createCollider(desc);
    }, undefined);
  }

  /**
   * Register a static box collider (building).
   * Returns a key that can be used to remove it later.
   */
  createBuildingCollider(
    position: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    entityId?: string,
  ): string {
    return this._guard('createBuildingCollider', () => {
      if (!this.RAPIER || !this.world) return '';
      const RAPIER = this.RAPIER;
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
      const body     = this.world.createRigidBody(bodyDesc);
      const collDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
      const coll     = this.world.createCollider(collDesc, body);
      const key = entityId ? `building:${entityId}` : `building_${Date.now()}_${Math.random()}`;
      this.bodies.set(key, body);
      this.colliders.set(key, coll);
      return key;
    }, '');
  }

  /**
   * Register a building collider derived from a Three.js Object3D's bounding box.
   * Idempotent: if `entityId` is already registered, returns existing key.
   * Stamps `userData.physicsKey` on the object so removeBuilding can find it later.
   */
  registerBuildingFromObject(
    obj: Object3DLike,
    entityId: string,
  ): string | null {
    if (!this.RAPIER || !this.world || !this.THREE) return null;
    const userData = obj.userData ?? (obj as Record<string, unknown>);
    const existing = (userData as Record<string, unknown>).physicsKey as string | undefined;
    if (existing && this.colliders.has(existing)) return existing;

    const box = new this.THREE.Box3();
    box.setFromObject(obj as unknown as InstanceType<ThreeType['Object3D']>);
    if (box.isEmpty()) return null;
    const center = new this.THREE.Vector3();
    const size   = new this.THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    // Tiny / degenerate bounding boxes are likely placeholders or empties; skip.
    if (size.x < 0.05 || size.y < 0.05 || size.z < 0.05) return null;

    const key = this.createBuildingCollider(
      { x: center.x, y: center.y, z: center.z },
      { x: size.x / 2, y: size.y / 2, z: size.z / 2 },
      entityId,
    );
    if (key) {
      (userData as Record<string, unknown>).physicsKey = key;
      (userData as Record<string, unknown>).isBuilding = true;
    }
    return key || null;
  }

  /** Remove a previously-registered building collider by its key. */
  removeBuildingCollider(key: string): void {
    this._guard('removeBuildingCollider', () => {
      if (!this.world || !key) return;
      const body = this.bodies.get(key);
      if (body) this.world.removeRigidBody(body);
      this.bodies.delete(key);
      this.colliders.delete(key);
    }, undefined);
  }

  /**
   * Walk a Three.js scene (or subtree) and register colliders for any
   * `userData.isBuilding === true` object OR any object with
   * `userData.colliderProfile` set to a registered shape kind.
   * Idempotent — call freely after scene-ready or async loads.
   * Returns the number of colliders newly registered.
   *
   * Phase 11 of polish-to-ten: extended past buildings to vegetation,
   * props, vehicles, npcs.
   *
   * Supported profiles:
   *   'box'     — AABB-derived box collider (same as buildings)
   *   'capsule' — vertical capsule sized to mesh height/half-extent.x
   *   'mesh'    — TODO; fall back to box for now (mesh colliders are heavy)
   *   'none' / undefined — skipped
   */
  syncFromScene(root: Object3DLike): number {
    if (!this.RAPIER || !this.world || !this.THREE || !root.traverse) return 0;
    let registered = 0;
    root.traverse((child) => {
      const ud = (child.userData ?? {}) as Record<string, unknown>;
      const profile = (ud.colliderProfile as string | undefined)
        ?? (ud.isBuilding ? 'box' : undefined);
      if (!profile || profile === 'none') return;
      if (ud.physicsKey && this.colliders.has(ud.physicsKey as string)) return;

      const baseId = (ud.buildingId as string)
        ?? (ud.entityId as string)
        ?? (ud.id as string)
        ?? `auto_${registered}_${Date.now()}`;
      const entityId = `${profile}:${baseId}`;

      let key: string | null = null;
      if (profile === 'capsule') {
        key = this._registerCapsuleFromObject(child, entityId);
      } else if (profile === 'mesh') {
        // Rapier trimesh — exact mesh-shape collision. Falls back to
        // AABB box if the mesh has no extractable geometry or exceeds
        // the perf cap.
        key = this._registerTrimeshFromObject(child, entityId);
        if (!key) key = this.registerBuildingFromObject(child, entityId);
      } else {
        // 'box' (or any unknown profile)
        key = this.registerBuildingFromObject(child, entityId);
      }
      if (key) {
        ud.isBuilding = true;
        ud.physicsKey = key;
        registered += 1;
      }
    });
    return registered;
  }

  /**
   * Rapier trimesh collider built from a Three.js Object3D's geometry.
   * Walks the subtree, finds the first child with a BufferGeometry, extracts
   * positions + indices, and creates a Rapier `ColliderDesc.trimesh`.
   *
   * Capped at 5000 triangles per collider to bound the perf cost — meshes
   * larger than that fall back to the cheaper AABB box collider via the
   * caller. Trimesh colliders are the heaviest shape Rapier supports;
   * registering many of them or any single huge one tanks step time.
   *
   * Static-only — trimesh on a dynamic body is not supported by Rapier.
   */
  private _registerTrimeshFromObject(obj: Object3DLike, entityId: string): string | null {
    return this._guard('_registerTrimeshFromObject', () => this._registerTrimeshFromObjectInner(obj, entityId), null);
  }

  private _registerTrimeshFromObjectInner(obj: Object3DLike, entityId: string): string | null {
    if (!this.RAPIER || !this.world || !this.THREE) return null;
    const ud = obj.userData ?? (obj as Record<string, unknown>);
    const existing = (ud as Record<string, unknown>).physicsKey as string | undefined;
    if (existing && this.colliders.has(existing)) return existing;

    type GeometryLike = {
      attributes?: { position?: { array: ArrayLike<number>; itemSize: number } };
      index?: { array: ArrayLike<number> } | null;
    };
    type Object3DTraversable = {
      traverse?: (cb: (child: { geometry?: GeometryLike; matrixWorld?: { elements: number[] }; updateMatrixWorld?: () => void }) => void) => void;
    };

    let positions: Float32Array | null = null;
    let indices: Uint32Array | null = null;

    (obj as unknown as Object3DTraversable).traverse?.((child) => {
      if (positions || !child.geometry) return;
      const geom = child.geometry;
      const posAttr = geom.attributes?.position;
      if (!posAttr || posAttr.itemSize !== 3) return;

      // Bake to world space so the trimesh is positioned correctly.
      // We pass position { 0, 0, 0 } to the rigidbody and rely on baked
      // vertex positions, since the parent group's transform may differ
      // per child.
      child.updateMatrixWorld?.();
      const mat = child.matrixWorld?.elements;
      const src = posAttr.array;
      const out = new Float32Array(src.length);
      if (mat) {
        for (let i = 0; i < src.length; i += 3) {
          const x = src[i] as number, y = src[i + 1] as number, z = src[i + 2] as number;
          out[i]     = mat[0] * x + mat[4] * y + mat[8]  * z + mat[12];
          out[i + 1] = mat[1] * x + mat[5] * y + mat[9]  * z + mat[13];
          out[i + 2] = mat[2] * x + mat[6] * y + mat[10] * z + mat[14];
        }
      } else {
        for (let i = 0; i < src.length; i++) out[i] = src[i] as number;
      }
      positions = out;

      if (geom.index) {
        const ia = geom.index.array;
        const ib = new Uint32Array(ia.length);
        for (let i = 0; i < ia.length; i++) ib[i] = ia[i] as number;
        indices = ib;
      } else {
        // Non-indexed geometry — fabricate sequential indices.
        const n = src.length / 3;
        const ib = new Uint32Array(n);
        for (let i = 0; i < n; i++) ib[i] = i;
        indices = ib;
      }
    });

    if (!positions || !indices) return null;

    // Perf cap: 5000 triangles per collider.
    const triCount = (indices as Uint32Array).length / 3;
    if (triCount > 5000) {
      console.warn(
        `[physicsWorld] trimesh ${entityId} has ${triCount} triangles (>5000 cap) — falling back to AABB box`,
      );
      return null;
    }

    const RAPIER = this.RAPIER;
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    const body     = this.world.createRigidBody(bodyDesc);
    const collDesc = RAPIER.ColliderDesc.trimesh(positions, indices);
    const coll     = this.world.createCollider(collDesc, body);

    const key = `trimesh:${entityId}`;
    this.bodies.set(key, body);
    this.colliders.set(key, coll);
    (ud as Record<string, unknown>).physicsKey = key;
    return key;
  }

  /**
   * Capsule collider derived from a Three.js Object3D's bounding box.
   * Used for vegetation trunks, NPCs, characters that live in the scene
   * outside the kinematic-controller path.
   */
  private _registerCapsuleFromObject(obj: Object3DLike, entityId: string): string | null {
    return this._guard('_registerCapsuleFromObject', () => this._registerCapsuleFromObjectInner(obj, entityId), null);
  }

  private _registerCapsuleFromObjectInner(obj: Object3DLike, entityId: string): string | null {
    if (!this.RAPIER || !this.world || !this.THREE) return null;
    const ud = obj.userData ?? (obj as Record<string, unknown>);
    const existing = (ud as Record<string, unknown>).physicsKey as string | undefined;
    if (existing && this.colliders.has(existing)) return existing;

    const box = new this.THREE.Box3();
    box.setFromObject(obj as unknown as InstanceType<ThreeType['Object3D']>);
    if (box.isEmpty()) return null;
    const center = new this.THREE.Vector3();
    const size   = new this.THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    if (size.x < 0.05 || size.y < 0.05 || size.z < 0.05) return null;

    const RAPIER = this.RAPIER;
    const halfHeight = Math.max(0.05, size.y / 2 - Math.min(size.x, size.z) / 2);
    const radius     = Math.max(0.05, Math.min(size.x, size.z) / 2);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
    const body     = this.world.createRigidBody(bodyDesc);
    const collDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
    const coll     = this.world.createCollider(collDesc, body);

    const key = `capsule:${entityId}`;
    this.bodies.set(key, body);
    this.colliders.set(key, coll);
    (ud as Record<string, unknown>).physicsKey = key;
    return key;
  }

  /**
   * Create a kinematic character controller (capsule) for a player or NPC.
   * Returns the controller; also stored internally under `id`.
   */
  createCharacterController(id: string): CharCtrl | null {
    return this._guard('createCharacterController', () => {
      if (!this.RAPIER || !this.world) return null;

      const RAPIER   = this.RAPIER;
      const offset   = 0.01;
      const ctrl     = this.world.createCharacterController(offset);
      ctrl.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
      ctrl.setMinSlopeSlideAngle((30 * Math.PI) / 180);
      ctrl.enableSnapToGround(0.5);
      ctrl.setApplyImpulsesToDynamicBodies(true);

      // Each controller needs its own collider (capsule shape)
      const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(0, 5, 0);
      const body = this.world.createRigidBody(bodyDesc);
      const collDesc = RAPIER.ColliderDesc.capsule(0.7, 0.3); // half-height, radius
      this.world.createCollider(collDesc, body);
      this.bodies.set(id, body);
      this.controllers.set(id, ctrl);
      return ctrl;
    }, null);
  }

  /**
   * Zero an entity's accumulated vertical velocity (and clear the airborne
   * flag). Called by the out-of-bounds / fall-recovery snapback so the player
   * doesn't keep the fall speed they'd built up after being teleported back to
   * solid ground. No-op for unknown ids.
   */
  resetVerticalVelocity(id: string): void {
    const ks = this.kinematic.get(id);
    if (ks) { ks.verticalVel = 0; ks.isAirborne = false; ks.gliding = false; }
  }

  /**
   * Move a character controller by `desiredTranslation`, returning the
   * collision-resolved actual translation applied.
   */
  moveCharacter(
    id: string,
    desiredTranslation: { x: number; y: number; z: number },
    dt: number,
  ): CharacterMoveResult {
    // Delta clamp (anti "blind dt trust"): a NaN / huge dt (tab-suspend resume,
    // or a spoofed value) would integrate gravity/velocity for thousands of
    // simulated seconds in one step → instant teleport into the void. Hard-cap
    // every physics step to 100ms and reject non-finite dt.
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    // Gate on full readiness — half-initialised worlds during the init()
    // await chain are the most common source of "recursive use of an
    // object" panics from this method.
    if (!this._ready) return desiredTranslation;
    if (this._inOp) {
      // Re-entrancy guard: Rapier WASM panics with "recursive use of an
      // object" if JS calls into the world while another op is mid-flight.
      // Skip this frame's move rather than crash. (Caused chromium/firefox
      // playthrough failures on heavy 3D worlds — pre-#373.)
      return desiredTranslation;
    }
    if (!this.world) return desiredTranslation;
    const ctrl = this.controllers.get(id);
    const body = this.bodies.get(id);
    if (!ctrl || !body) return desiredTranslation;
    this._inOp = true;
    try {
      return this._moveCharacterInner(id, desiredTranslation, dt, ctrl, body);
    } finally {
      // try/finally — without it, a Rapier panic mid-method left _inOp
      // permanently true, silently blocking every subsequent step() and
      // creator method. That looked like "physics randomly stops working"
      // and turned single panics into cascading failures across frames.
      this._inOp = false;
    }
  }

  private _moveCharacterInner(
    id: string,
    desiredTranslation: { x: number; y: number; z: number },
    dt: number,
    ctrl: CharCtrl,
    body: RigidBody,
  ): CharacterMoveResult {
    if (!this.world) return desiredTranslation;

    const collider = this.world.getCollider(0); // character's own collider
    // Find the collider attached to this body
    let charCollider = collider;
    this.world.forEachCollider(c => {
      if (c.parent()?.handle === body.handle) charCollider = c;
    });

    const ks = this._ensureKinematic(id);
    // Finite guard: a NaN that ever lands in verticalVel (e.g. a divide-by-zero
    // upstream) would propagate to the capsule's Y and break the avatar's
    // position permanently. Reset to 0 so integration stays well-defined.
    if (!Number.isFinite(ks.verticalVel)) ks.verticalVel = 0;
    const now = performance.now();

    // Theme 5 (game-feel pass): kinematic knockback. Add the active
    // knockback velocity (×dt) to the desired translation. Linearly
    // decay during its lifetime so the impulse "lands" rather than
    // teleports. Cap total displacement at MAX_KB_M.
    let kbDx = 0;
    let kbDz = 0;
    if (ks.kbExpiresAt > 0) {
      if (now < ks.kbExpiresAt) {
        const remainingMs = ks.kbExpiresAt - now;
        const totalMs     = ks.kbExpiresAt - ks.kbStartedAt;
        // Linear ramp: 1.0 at start → 0.0 at end.
        const frac = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
        kbDx = ks.kbVx * frac * dt;
        kbDz = ks.kbVz * frac * dt;
        // Enforce displacement cap.
        const stepMag = Math.hypot(kbDx, kbDz);
        const remaining = MAX_KB_M - ks.kbTravelled;
        if (stepMag > remaining) {
          const k = remaining / stepMag;
          kbDx *= k;
          kbDz *= k;
          ks.kbExpiresAt = 0; // no more travel from this impulse
        }
        ks.kbTravelled += Math.hypot(kbDx, kbDz);
      } else {
        ks.kbExpiresAt = 0;
        ks.kbTravelled = 0;
      }
    }

    // Theme 6 (game-feel pass): vertical velocity integration. The
    // kinematicPositionBased capsule won't accept applyImpulse /
    // setLinvel — instead we maintain verticalVel ourselves and fold it
    // into desiredTranslation each frame. Snap-to-ground is suppressed
    // during the airborne window so jumps actually leave the ground.
    let verticalDelta = 0;
    if (ks.swimming) {
      // Underwater: dampen vertical velocity, light buoyancy lift, low gravity.
      // Result: capsule slowly rises if swimmer doesn't push down.
      ks.verticalVel = ks.verticalVel * 0.85
        + (SWIM_BUOYANCY * 0.6) * dt
        - SWIM_GRAVITY * dt;
      ks.verticalVel = Math.max(-3.0, Math.min(3.5, ks.verticalVel));
      verticalDelta = ks.verticalVel * dt;
      ks.isAirborne = false;
    } else if (ks.isAirborne || ks.verticalVel !== 0) {
      ks.verticalVel -= GRAVITY * dt;
      if (ks.gliding && ks.verticalVel < GLIDE_DESCENT_CAP) {
        ks.verticalVel = GLIDE_DESCENT_CAP;
      }
      verticalDelta = ks.verticalVel * dt;
    }

    // Glide horizontal boost — small forward push so the silhouette has
    // forward motion even when the player isn't holding W.
    let glideBoostX = 0;
    let glideBoostZ = 0;
    if (ks.gliding) {
      glideBoostX = desiredTranslation.x * GLIDE_HORIZ_BOOST;
      glideBoostZ = desiredTranslation.z * GLIDE_HORIZ_BOOST;
    }

    // Part B — dash burst: a short directional velocity that decays over the
    // dash window, folded in like knockback so it composes with input + glide.
    let dashDx = 0;
    let dashDz = 0;
    const ts = this.traversal.get(id);
    if (ts) {
      const dv = dashVelocityAt(ts, now);
      dashDx = dv.vx * dt;
      dashDz = dv.vz * dt;
    }

    const finalDesired = {
      x: desiredTranslation.x + kbDx + glideBoostX + dashDx,
      y: desiredTranslation.y + verticalDelta,
      z: desiredTranslation.z + kbDz + glideBoostZ + dashDz,
    };

    // Snap-to-ground policy: re-enable after the suppress window expires
    // and the verticalVel has gone non-positive (started falling). This
    // is what lets short hops leave the ground without immediately being
    // sucked back down.
    if (ks.snapDisabledUntil > 0 && now > ks.snapDisabledUntil) {
      try { ctrl.enableSnapToGround(0.5); } catch { /* RAPIER may have no method */ }
      ks.snapDisabledUntil = 0;
    }

    ctrl.computeColliderMovement(charCollider, finalDesired, undefined, undefined);
    const corrected = ctrl.computedMovement();

    // Apply to kinematic body
    const pos = body.translation();
    body.setNextKinematicTranslation({
      x: pos.x + corrected.x,
      y: pos.y + corrected.y,
      z: pos.z + corrected.z,
    });

    // Update grounded state from Rapier's computedGrounded() (true when
    // the controller resolved a downward contact). Reset verticalVel to
    // 0 on ground contact so we don't accumulate downward force.
    let grounded = false;
    try { grounded = (ctrl as { computedGrounded?: () => boolean }).computedGrounded?.() ?? false; }
    catch { grounded = false; }
    if (grounded && !ks.swimming) {
      // Only re-zero if we're moving down or already at rest. A jump
      // frame still has positive verticalVel; don't clobber it.
      if (ks.verticalVel <= 0) {
        ks.verticalVel = 0;
        ks.isAirborne = false;
        // B1 — record the ground contact (coyote source) + flush a buffered
        // jump that was pressed just before landing.
        const nowMs = Date.now();
        ks.lastGroundedAt = nowMs;
        if (shouldFlushBuffer(ks, nowMs)) {
          ks.verticalVel = ks.jumpVyPending || JUMP_DEFAULT_VY;
          ks.isAirborne = true;
          ks.snapDisabledUntil = nowMs + 250;
        }
        ks.jumpBufferedAt = 0;
      }
    } else if (!ks.swimming && Math.abs(verticalDelta) > 0.01) {
      ks.isAirborne = true;
    }

    // _inOp is reset by the caller's try/finally; never touch it from here.
    return { x: corrected.x / dt, y: corrected.y / dt, z: corrected.z / dt };
  }

  /** Get-or-create the kinematic state for an entity. */
  private _ensureKinematic(id: string): KinematicState {
    let ks = this.kinematic.get(id);
    if (!ks) {
      ks = {
        kbVx: 0, kbVz: 0,
        kbStartedAt: 0, kbExpiresAt: 0, kbTravelled: 0,
        verticalVel: 0,
        isAirborne: false,
        snapDisabledUntil: 0,
        gliding: false,
        swimming: false,
        lastGroundedAt: 0,
        jumpBufferedAt: 0,
        jumpVyPending: 0,
      };
      this.kinematic.set(id, ks);
    }
    return ks;
  }

  /**
   * Theme 5 (game-feel pass): apply a kinematic knockback impulse to a
   * character controller. moveCharacter folds the velocity into desired
   * translation per frame for `durationMs`; total displacement capped at
   * MAX_KB_M (1.5 m). No-op for non-existent controllers.
   *
   * Use case: combat-hit-heavy → knock the target back from the impact
   * direction. Player capsule is kinematicPositionBased so applyImpulse
   * is silently ignored — this is the right path.
   *
   * @param id           controller id (player / NPC)
   * @param direction    {x, z} unit vector pointing AWAY from impactor
   * @param magnitude    target initial speed in m/s (clamped to a sane range)
   * @param durationMs   total time for the impulse (default 220ms)
   */
  knockbackKinematic(
    id: string,
    direction: { x: number; z: number },
    magnitude: number,
    durationMs: number = KB_DEFAULT_MS,
  ): boolean {
    if (!this.controllers.has(id)) return false;
    const m = Math.max(0, Math.min(8, Number(magnitude)));
    if (m === 0) return false;
    const dx = Number(direction?.x) || 0;
    const dz = Number(direction?.z) || 0;
    const mag = Math.hypot(dx, dz);
    if (mag === 0) return false;
    const ux = dx / mag;
    const uz = dz / mag;
    const dur = Math.max(50, Math.min(800, Number(durationMs)));
    const now = performance.now();
    const ks = this._ensureKinematic(id);
    ks.kbVx = ux * m;
    ks.kbVz = uz * m;
    ks.kbStartedAt = now;
    ks.kbExpiresAt = now + dur;
    ks.kbTravelled = 0;
    return true;
  }

  /** Returns true when `id` has an active knockback impulse. Useful for
   *  the avatar update loop to suspend other steering forces during
   *  knockback so the impulse reads as a clean recoil. */
  isKnockedBack(id: string): boolean {
    const ks = this.kinematic.get(id);
    if (!ks) return false;
    return ks.kbExpiresAt > performance.now();
  }

  // ── Theme 6 (game-feel pass): jump / glide / swim API ──────────────────────

  /**
   * Request a jump for `id`. Sets verticalVel to jumpVy, marks the
   * controller airborne, and disables snap-to-ground for ~250ms so the
   * capsule actually leaves the ground. No-op if not grounded
   * (prevents double-jump cheese).
   */
  requestJump(id: string, jumpVy: number = JUMP_DEFAULT_VY): boolean {
    if (!this.controllers.has(id)) return false;
    const ks = this._ensureKinematic(id);
    if (ks.kbExpiresAt > performance.now()) return false; // can't jump while knocked back
    const vy = Math.max(0.5, Math.min(15, Number(jumpVy)));
    const now = Date.now();
    // B1 — coyote time: a jump just after leaving a ledge still fires.
    if (!canJump(ks, now)) {
      // B1 — jump buffer: pressed mid-air → queue it; it fires on touchdown.
      ks.jumpBufferedAt = now;
      ks.jumpVyPending = vy;
      return false;
    }
    ks.verticalVel = vy;
    ks.isAirborne = true;
    ks.jumpBufferedAt = 0;
    ks.snapDisabledUntil = performance.now() + 250;
    const ctrl = this.controllers.get(id);
    try { (ctrl as { disableSnapToGround?: () => void }).disableSnapToGround?.(); } catch { /* ok */ }
    return true;
  }

  /**
   * B1 — variable jump height: releasing the jump button early cuts the ascent
   * for a shorter hop. No-op while falling or grounded.
   */
  releaseJump(id: string): void {
    const ks = this.kinematic.get(id);
    if (!ks || !ks.isAirborne) return;
    ks.verticalVel = cutJump(ks.verticalVel);
  }

  /** Returns true when the controller is currently airborne (jumping or falling). */
  isAirborne(id: string): boolean {
    return !!this.kinematic.get(id)?.isAirborne;
  }

  /** Returns true when the controller's last frame resolved a grounded
   *  contact AND we're not in a jump frame. */
  isGrounded(id: string): boolean {
    const ks = this.kinematic.get(id);
    if (!ks) return true;
    return !ks.isAirborne && !ks.swimming;
  }

  /**
   * Toggle glide for `id`. Activating glide while airborne clamps
   * descent at GLIDE_DESCENT_CAP and adds GLIDE_HORIZ_BOOST forward
   * momentum. Activating while grounded is a no-op so accidental
   * Space-press while running doesn't trigger glide. */
  setGlide(id: string, on: boolean): boolean {
    const ks = this._ensureKinematic(id);
    if (on && !ks.isAirborne) return false;
    ks.gliding = !!on;
    return true;
  }

  /** Returns true when glide is active for `id`. */
  isGliding(id: string): boolean {
    return !!this.kinematic.get(id)?.gliding;
  }

  /**
   * Toggle swim for `id`. Activating swim disables glide and reduces
   * gravity; deactivating restores normal kinematics. Caller is
   * responsible for figuring out when the capsule entered/left water
   * (compares Y vs world water-level — no water collider in the
   * registered world yet). */
  setSwim(id: string, on: boolean): boolean {
    const ks = this._ensureKinematic(id);
    ks.swimming = !!on;
    if (on) ks.gliding = false;
    return true;
  }

  /** Returns true when swim is active for `id`. */
  isSwimming(id: string): boolean {
    return !!this.kinematic.get(id)?.swimming;
  }

  // ── Part B (B1): traversal verbs — dash / dodge (+ i-frames) ───────────────

  private _ensureTraversal(id: string): TraversalState {
    let ts = this.traversal.get(id);
    if (!ts) { ts = freshTraversalState(); this.traversal.set(id, ts); }
    return ts;
  }

  /**
   * Request a dash/dodge in a world-space direction. Sets a decaying velocity
   * burst (folded into moveCharacter) + a brief i-frame window. No-op while a
   * dash is already active (no dash-cancel-into-dash spam) or knocked back.
   * Returns true if the dash started.
   */
  requestDash(id: string, dirX: number, dirZ: number): boolean {
    if (!this.controllers.has(id)) return false;
    const ks = this.kinematic.get(id);
    if (ks && ks.kbExpiresAt > performance.now()) return false; // not while knocked back
    const ts = this._ensureTraversal(id);
    const now = performance.now();
    if (ts.dashExpiresAt > now) return false; // already dashing
    if (dirX === 0 && dirZ === 0) return false;
    beginDash(ts, dirX, dirZ, now);
    return true;
  }

  /** True during the dash i-frame window (combat should ignore damage). */
  isInvulnerable(id: string): boolean {
    const ts = this.traversal.get(id);
    return ts ? tkInvulnerable(ts, performance.now()) : false;
  }

  /** Toggle slide (crouch-while-fast); purely a state flag the animator reads. */
  setSlide(id: string, on: boolean): void {
    this._ensureTraversal(id).sliding = !!on;
  }

  isSliding(id: string): boolean {
    return !!this.traversal.get(id)?.sliding;
  }

  // ── Theme 6 (game-feel pass): water plane registry ────────────────────────
  //
  // No actual water-collider primitive exists yet (terrain is sine-wave
  // heightfield, no water mesh). Until one ships we expose a single
  // per-world Y-level constant so AvatarSystem3D can detect "below water"
  // and toggle swim mode. registerWaterPlane is the caller-friendly
  // setter; getWaterLevelFor reads it back; null = no water for that
  // world (don't ever flip swim mode).
  private waterLevels: Map<string, number> = new Map();
  registerWaterPlane(worldId: string, yLevel: number): void {
    if (!worldId || !Number.isFinite(yLevel)) return;
    this.waterLevels.set(worldId, yLevel);
  }
  getWaterLevelFor(worldId: string): number | null {
    if (!worldId) return null;
    const v = this.waterLevels.get(worldId);
    return Number.isFinite(v) ? (v as number) : null;
  }

  /** Remove a character controller and its body. */
  removeCharacter(id: string): void {
    this._guard('removeCharacter', () => {
      if (!this.world) return;
      const body = this.bodies.get(id);
      if (body) this.world.removeRigidBody(body);
      this.bodies.delete(id);
      const ctrl = this.controllers.get(id);
      if (ctrl) this.world.removeCharacterController(ctrl);
      this.controllers.delete(id);
      this.kinematic.delete(id);
    }, undefined);
  }

  /**
   * Hard-teleport a character to an absolute world position (fast-travel /
   * respawn). Sets BOTH the rigid-body translation and the next kinematic
   * target — otherwise the controller would lerp back from the old spot on the
   * next step — and clears vertical velocity + knockback + air/glide/swim flags
   * so the avatar arrives at rest. Returns false if the character isn't known.
   */
  teleportCharacter(id: string, position: { x: number; y: number; z: number }): boolean {
    return this._guard('teleportCharacter', () => {
      const body = this.bodies.get(id);
      if (!body) return false;
      const p = { x: position.x, y: position.y, z: position.z };
      body.setTranslation(p, true);
      body.setNextKinematicTranslation(p);
      const ks = this.kinematic.get(id);
      if (ks) {
        ks.verticalVel = 0;
        ks.kbVx = 0; ks.kbVz = 0; ks.kbTravelled = 0; ks.kbExpiresAt = 0;
        ks.isAirborne = false;
        ks.gliding = false;
        ks.swimming = false;
      }
      return true;
    }, false);
  }

  // ── Projectiles ────────────────────────────────────────────────────────────
  //
  // Phase F2 init 2: dynamic rigid bodies for arrows / bullets / thrown items.
  // Each projectile is a small dynamic body with a sphere collider, ballistic
  // trajectory under gravity, and a TTL after which it auto-disposes.

  private projectiles: Map<string, { body: RigidBody; spawnedAt: number; ttl: number; ownerId?: string; damage?: number; onHit?: (hitEntityId: string) => void }> = new Map();

  /**
   * Spawn a projectile with an initial velocity. Returns its physics id.
   * Caller renders a visual mesh whose position tracks getProjectilePosition(id).
   */
  spawnProjectile(opts: {
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    radius?:  number;
    mass?:    number;
    ttlMs?:   number;
    ownerId?: string;
    damage?:  number;
    onHit?:   (hitEntityId: string) => void;
  }): string | null {
    if (!this.RAPIER || !this.world) return null;
    const RAPIER = this.RAPIER;
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(opts.position.x, opts.position.y, opts.position.z)
      .setLinvel(opts.velocity.x, opts.velocity.y, opts.velocity.z)
      .setLinearDamping(0.05)        // light air resistance
      .setCcdEnabled(true);          // continuous collision so fast projectiles don't tunnel
    const body = this.world.createRigidBody(bodyDesc);

    const collDesc = RAPIER.ColliderDesc.ball(opts.radius ?? 0.08)
      .setMass(opts.mass ?? 0.05)
      .setRestitution(0.2)
      .setFriction(0.3)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.world.createCollider(collDesc, body);

    this.projectiles.set(id, {
      body,
      spawnedAt: performance.now(),
      ttl:       opts.ttlMs ?? 6000,
      ownerId:   opts.ownerId,
      damage:    opts.damage,
      onHit:     opts.onHit,
    });
    this.bodies.set(id, body);
    return id;
  }

  /** World-space position of a live projectile. Returns null if expired/missing. */
  getProjectilePosition(id: string): { x: number; y: number; z: number } | null {
    const p = this.projectiles.get(id);
    if (!p) return null;
    const t = p.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /**
   * Sweep expired projectiles. Call once per frame from the host scene.
   * Also scans the projectile body's contact pairs and fires onHit callbacks.
   */
  stepProjectiles(now: number = performance.now()): void {
    if (!this.world) return;
    for (const [id, p] of this.projectiles) {
      if (now - p.spawnedAt > p.ttl) {
        this.world.removeRigidBody(p.body);
        this.projectiles.delete(id);
        this.bodies.delete(id);
        continue;
      }

      // Hit detection: scan colliders touching the projectile.
      // Rapier doesn't expose contact events without an EventQueue; we use a
      // proximity narrow-phase check via intersectionsWith. The bodies' user
      // data carries an `entityId` set by spawn helpers.
      const projCollider = this.world.getCollider(0);
      let hit: { entityId: string } | null = null;
      this.world.forEachCollider(c => {
        if (hit) return;
        if (c.parent()?.handle === p.body.handle) return;
        if (this.world!.intersectionPair(c, projCollider!) || (this.world as unknown as { intersectionPairsWith?: (c: unknown, cb: (other: unknown) => void) => void }).intersectionPairsWith) {
          const other = c.parent();
          const ud = other ? (other.userData as { entityId?: string } | undefined) : undefined;
          if (ud?.entityId && ud.entityId !== p.ownerId) hit = { entityId: ud.entityId };
        }
      });
      if (hit) {
        const hitInfo = hit as { entityId: string };
        try { p.onHit?.(hitInfo.entityId); } catch { /* listener best-effort */ }
        this.world.removeRigidBody(p.body);
        this.projectiles.delete(id);
        this.bodies.delete(id);
      }
    }
  }

  // ── Ragdoll on death ───────────────────────────────────────────────────────
  //
  // When an NPC dies, swap its kinematic capsule for a ragdoll: a chain of
  // dynamic bodies (head, torso, hips, 4 limb segments) connected by joints.
  // The bodies tumble under gravity and the host renderer reads each segment
  // pose to drive the bone transforms.

  private ragdolls: Map<string, RagdollHandle> = new Map();

  /**
   * Convert a character into a ragdoll. The capsule is removed; a new body
   * graph is created and returned. Caller binds bone transforms each frame
   * via getRagdollPose(id, segment).
   */
  spawnRagdoll(id: string, position: { x: number; y: number; z: number }, impulse?: { x: number; y: number; z: number }): RagdollHandle | null {
    if (!this.RAPIER || !this.world) return null;
    const RAPIER = this.RAPIER;

    // Free the kinematic character if present.
    this.removeCharacter(id);

    const segments: RagdollSegment[] = [
      { name: "torso",     halfH: 0.30, radius: 0.18, parentIdx: -1, anchorParent: { x: 0,    y:  0.30, z: 0 }, anchorChild: { x: 0, y: 0, z: 0 } },
      { name: "head",      halfH: 0.10, radius: 0.12, parentIdx:  0, anchorParent: { x: 0,    y:  0.40, z: 0 }, anchorChild: { x: 0, y: -0.10, z: 0 } },
      { name: "hips",      halfH: 0.12, radius: 0.18, parentIdx:  0, anchorParent: { x: 0,    y: -0.30, z: 0 }, anchorChild: { x: 0, y:  0.10, z: 0 } },
      { name: "leftThigh", halfH: 0.20, radius: 0.10, parentIdx:  2, anchorParent: { x: -0.10, y: -0.10, z: 0 }, anchorChild: { x: 0, y:  0.20, z: 0 } },
      { name: "rightThigh",halfH: 0.20, radius: 0.10, parentIdx:  2, anchorParent: { x:  0.10, y: -0.10, z: 0 }, anchorChild: { x: 0, y:  0.20, z: 0 } },
      { name: "leftArm",   halfH: 0.20, radius: 0.08, parentIdx:  0, anchorParent: { x: -0.20, y:  0.20, z: 0 }, anchorChild: { x: 0, y:  0.20, z: 0 } },
      { name: "rightArm",  halfH: 0.20, radius: 0.08, parentIdx:  0, anchorParent: { x:  0.20, y:  0.20, z: 0 }, anchorChild: { x: 0, y:  0.20, z: 0 } },
    ];

    const bodies: RigidBody[] = [];
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const seedY = position.y + (i === 0 ? 1.0 : 0.5);
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, seedY, position.z)
        .setLinearDamping(0.5)
        .setAngularDamping(0.5);
      const body = this.world.createRigidBody(desc);
      const cd = RAPIER.ColliderDesc.capsule(s.halfH, s.radius)
        .setMass(s.name === "torso" ? 12 : s.name === "head" ? 4 : 3)
        .setFriction(0.8);
      this.world.createCollider(cd, body);
      bodies.push(body);
    }

    // Joints: spherical for shoulders/hips, revolute would be more correct
    // for elbows/knees but we ship one-segment limbs so spherical suffices.
    for (let i = 1; i < segments.length; i++) {
      const s = segments[i];
      if (s.parentIdx < 0) continue;
      const parent = bodies[s.parentIdx];
      const child  = bodies[i];
      const jointDesc = RAPIER.JointData.spherical(s.anchorParent, s.anchorChild);
      this.world.createImpulseJoint(jointDesc, parent, child, true);
    }

    // Initial impulse — a death blow direction.
    if (impulse) {
      bodies[0].applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
      bodies[1].applyImpulse({ x: impulse.x * 0.4, y: impulse.y * 0.6, z: impulse.z * 0.4 }, true);
    }

    const handle: RagdollHandle = {
      id,
      bodies,
      segmentNames: segments.map(s => s.name),
      spawnedAt: performance.now(),
    };
    this.ragdolls.set(id, handle);
    return handle;
  }

  /** Read the world transform of a ragdoll segment so the renderer can drive bones. */
  getRagdollPose(id: string, segmentName: string): { x: number; y: number; z: number; rx: number; ry: number; rz: number; rw: number } | null {
    const r = this.ragdolls.get(id);
    if (!r) return null;
    const idx = r.segmentNames.indexOf(segmentName);
    if (idx < 0) return null;
    const body = r.bodies[idx];
    const t = body.translation();
    const q = body.rotation();
    return { x: t.x, y: t.y, z: t.z, rx: q.x, ry: q.y, rz: q.z, rw: q.w };
  }

  /** Free a ragdoll's bodies + joints (call after the body's faded out). */
  removeRagdoll(id: string): void {
    if (!this.world) return;
    const r = this.ragdolls.get(id);
    if (!r) return;
    for (const b of r.bodies) {
      try { this.world.removeRigidBody(b); } catch { /* idempotent */ }
    }
    this.ragdolls.delete(id);
  }

  /** All currently-active ragdoll ids. Useful for cleanup loops. */
  getRagdollIds(): string[] {
    return [...this.ragdolls.keys()];
  }

  /** Dispose the entire physics world.
   *  React 18 strict-mode double-mounts components in dev; if a fresh
   *  PhysicsWorld is constructed between two destroy() calls some
   *  internal Rapier handles can end up null when free() walks them
   *  ("null pointer passed to rust"). try/catch keeps the page alive
   *  through the harmless double-destroy.
   *
   *  Since physicsWorld is a module-level singleton, EVERY transient
   *  lifecycle field (_ready, _inOp, _destroyed) AND the per-entity maps
   *  must be cleared here. init() then resets _destroyed=false and
   *  builds a fresh world. Without this, a remount after destroy would
   *  inherit a stuck _inOp from a Rapier panic mid-frame, silently
   *  blocking every subsequent step()/creator call ("physics randomly
   *  stops working" after a route change in dev).
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._ready = false;
    this._inOp = false;
    try { this.world?.free(); }
    catch (err) { /* harmless under strict-mode double-mount */ void err; }
    this.world  = null;
    this.RAPIER = null;
    this.THREE  = null;
    this.controllers.clear();
    this.bodies.clear();
    this.colliders.clear();
    // kinematic state was previously NOT cleared on destroy. A subsequent
    // init() that created a controller under the same id (e.g. 'player')
    // would inherit the OLD world's KinematicState — stale verticalVel,
    // stale isAirborne, stale knockback timers. Causes "player can't jump
    // after a route change" type bugs. Drop it.
    this.kinematic.clear();
    this.waterLevels.clear();
    this.projectiles.clear();
    this.ragdolls.clear();
  }
  private _destroyed = false;
}

export const physicsWorld = new PhysicsWorld();
