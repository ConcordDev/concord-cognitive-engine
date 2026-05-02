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
