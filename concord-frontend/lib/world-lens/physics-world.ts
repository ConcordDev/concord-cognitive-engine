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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RapierType = typeof import('@dimforge/rapier3d-compat');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

class PhysicsWorld {
  private RAPIER: RapierType | null         = null;
  private THREE:  ThreeType | null          = null;
  private world:  WorldType | null          = null;
  private controllers: Map<string, CharCtrl>  = new Map();
  private bodies:      Map<string, RigidBody>  = new Map();
  private colliders:   Map<string, Collider>   = new Map();

  /** Load Rapier WASM and create the physics world. Call once at scene startup. */
  async init(): Promise<void> {
    if (this.world) return;
    const RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();
    this.RAPIER = RAPIER;
    this.world  = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // Pre-load THREE so building registration can compute bounding boxes synchronously.
    this.THREE = await import('three');
  }

  /** Advance physics simulation by dt seconds. Call every game-loop frame. */
  step(dt: number): void {
    if (!this.world) return;
    this.world.timestep = Math.min(dt, 0.05); // cap at 50ms
    this.world.step();
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
    if (!this.RAPIER || !this.world) return;

    const RAPIER = this.RAPIER;
    const desc = RAPIER.ColliderDesc.heightfield(
      hmHeight - 1,
      hmWidth  - 1,
      hmData,
      { x: worldScale.x, y: worldScale.y, z: worldScale.z },
    );
    desc.setTranslation(0, 0, 0);
    this.world.createCollider(desc);
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
    if (!this.world || !key) return;
    const body = this.bodies.get(key);
    if (body) this.world.removeRigidBody(body);
    this.bodies.delete(key);
    this.colliders.delete(key);
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
      } else {
        // 'box' or 'mesh' (mesh falls back to AABB box for now)
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
   * Capsule collider derived from a Three.js Object3D's bounding box.
   * Used for vegetation trunks, NPCs, characters that live in the scene
   * outside the kinematic-controller path.
   */
  private _registerCapsuleFromObject(obj: Object3DLike, entityId: string): string | null {
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
    if (!this.world) return desiredTranslation;
    const ctrl = this.controllers.get(id);
    const body = this.bodies.get(id);
    if (!ctrl || !body) return desiredTranslation;

    const collider = this.world.getCollider(0); // character's own collider
    // Find the collider attached to this body
    let charCollider = collider;
    this.world.forEachCollider(c => {
      if (c.parent()?.handle === body.handle) charCollider = c;
    });

    ctrl.computeColliderMovement(charCollider, desiredTranslation, undefined, undefined);
    const corrected = ctrl.computedMovement();

    // Apply to kinematic body
    const pos = body.translation();
    body.setNextKinematicTranslation({
      x: pos.x + corrected.x,
      y: pos.y + corrected.y,
      z: pos.z + corrected.z,
    });

    return { x: corrected.x / dt, y: corrected.y / dt, z: corrected.z / dt };
  }

  /** Remove a character controller and its body. */
  removeCharacter(id: string): void {
    if (!this.world) return;
    const body = this.bodies.get(id);
    if (body) this.world.removeRigidBody(body);
    this.bodies.delete(id);
    const ctrl = this.controllers.get(id);
    if (ctrl) this.world.removeCharacterController(ctrl);
    this.controllers.delete(id);
  }

  /** Dispose the entire physics world. */
  destroy(): void {
    this.world?.free();
    this.world  = null;
    this.RAPIER = null;
    this.THREE  = null;
    this.controllers.clear();
    this.bodies.clear();
    this.colliders.clear();
  }
}

export const physicsWorld = new PhysicsWorld();
