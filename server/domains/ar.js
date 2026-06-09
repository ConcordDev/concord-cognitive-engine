// server/domains/ar.js
// Domain actions for augmented reality: spatial mapping, marker detection, scene graph analysis.

export default function registerArActions(registerLensAction) {
  /**
   * spatialMapping
   * Process spatial anchor data — compute bounding volumes, occlusion zones,
   * surface classification, spatial hash grid for proximity queries.
   * artifact.data.anchors: [{ id, position: {x,y,z}, rotation?: {x,y,z,w}, extent?: {width,height,depth}, surfaceType?, vertices?: [{x,y,z}] }]
   * params.gridCellSize — spatial hash grid cell size (default 1.0)
   * params.proximityRadius — radius for proximity queries (default 2.0)
   */
  registerLensAction("ar", "spatialMapping", (ctx, artifact, params) => {
  try {
    const anchors = artifact.data.anchors || [];
    if (anchors.length === 0) {
      return { ok: true, result: { message: "No spatial anchors provided." } };
    }

    const gridCellSize = params.gridCellSize || 1.0;
    const proximityRadius = params.proximityRadius || 2.0;

    // Compute AABB (axis-aligned bounding box) for each anchor
    const processed = anchors.map(anchor => {
      const pos = anchor.position || { x: 0, y: 0, z: 0 };
      const extent = anchor.extent || { width: 0.1, height: 0.1, depth: 0.1 };
      const halfW = extent.width / 2;
      const halfH = extent.height / 2;
      const halfD = extent.depth / 2;

      const aabb = {
        min: { x: pos.x - halfW, y: pos.y - halfH, z: pos.z - halfD },
        max: { x: pos.x + halfW, y: pos.y + halfH, z: pos.z + halfD },
      };

      // Volume
      const volume = Math.round(extent.width * extent.height * extent.depth * 10000) / 10000;

      // Surface area
      const surfaceArea = Math.round(2 * (
        extent.width * extent.height +
        extent.height * extent.depth +
        extent.width * extent.depth
      ) * 10000) / 10000;

      // Classify surface based on extent ratios
      let classification = anchor.surfaceType || "unknown";
      if (classification === "unknown") {
        const maxDim = Math.max(extent.width, extent.height, extent.depth);
        const minDim = Math.min(extent.width, extent.height, extent.depth);
        const ratio = maxDim > 0 ? minDim / maxDim : 1;

        if (extent.height < extent.width * 0.2 && extent.height < extent.depth * 0.2) {
          classification = "horizontal-plane";
        } else if (extent.width < extent.height * 0.2 || extent.depth < extent.height * 0.2) {
          classification = "vertical-plane";
        } else if (ratio > 0.6) {
          classification = "volumetric";
        } else {
          classification = "slab";
        }
      }

      return {
        id: anchor.id,
        position: pos,
        extent,
        aabb,
        volume,
        surfaceArea,
        classification,
      };
    });

    // Build spatial hash grid
    const grid = {};
    for (const anchor of processed) {
      const cellX = Math.floor(anchor.position.x / gridCellSize);
      const cellY = Math.floor(anchor.position.y / gridCellSize);
      const cellZ = Math.floor(anchor.position.z / gridCellSize);
      const cellKey = `${cellX}:${cellY}:${cellZ}`;
      if (!grid[cellKey]) grid[cellKey] = [];
      grid[cellKey].push(anchor.id);
    }

    // Compute distance between all pairs and find proximity clusters
    function dist3d(a, b) {
      return Math.sqrt(
        Math.pow(a.x - b.x, 2) +
        Math.pow(a.y - b.y, 2) +
        Math.pow(a.z - b.z, 2)
      );
    }

    const proximityPairs = [];
    for (let i = 0; i < processed.length; i++) {
      for (let j = i + 1; j < processed.length; j++) {
        const d = dist3d(processed[i].position, processed[j].position);
        if (d <= proximityRadius) {
          proximityPairs.push({
            anchorA: processed[i].id,
            anchorB: processed[j].id,
            distance: Math.round(d * 10000) / 10000,
          });
        }
      }
    }

    // Detect occlusion zones: overlapping AABBs
    function aabbOverlap(a, b) {
      return a.min.x <= b.max.x && a.max.x >= b.min.x &&
             a.min.y <= b.max.y && a.max.y >= b.min.y &&
             a.min.z <= b.max.z && a.max.z >= b.min.z;
    }

    const occlusionZones = [];
    for (let i = 0; i < processed.length; i++) {
      for (let j = i + 1; j < processed.length; j++) {
        if (aabbOverlap(processed[i].aabb, processed[j].aabb)) {
          // Compute overlap volume
          const overlapMin = {
            x: Math.max(processed[i].aabb.min.x, processed[j].aabb.min.x),
            y: Math.max(processed[i].aabb.min.y, processed[j].aabb.min.y),
            z: Math.max(processed[i].aabb.min.z, processed[j].aabb.min.z),
          };
          const overlapMax = {
            x: Math.min(processed[i].aabb.max.x, processed[j].aabb.max.x),
            y: Math.min(processed[i].aabb.max.y, processed[j].aabb.max.y),
            z: Math.min(processed[i].aabb.max.z, processed[j].aabb.max.z),
          };
          const overlapVolume = Math.round(
            Math.max(0, overlapMax.x - overlapMin.x) *
            Math.max(0, overlapMax.y - overlapMin.y) *
            Math.max(0, overlapMax.z - overlapMin.z) * 10000
          ) / 10000;

          occlusionZones.push({
            anchorA: processed[i].id,
            anchorB: processed[j].id,
            overlapVolume,
            overlapRegion: { min: overlapMin, max: overlapMax },
          });
        }
      }
    }

    // Surface classification summary
    const surfaceSummary = {};
    for (const a of processed) {
      surfaceSummary[a.classification] = (surfaceSummary[a.classification] || 0) + 1;
    }

    // Scene bounding box
    const sceneBounds = {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
    };
    for (const a of processed) {
      sceneBounds.min.x = Math.min(sceneBounds.min.x, a.aabb.min.x);
      sceneBounds.min.y = Math.min(sceneBounds.min.y, a.aabb.min.y);
      sceneBounds.min.z = Math.min(sceneBounds.min.z, a.aabb.min.z);
      sceneBounds.max.x = Math.max(sceneBounds.max.x, a.aabb.max.x);
      sceneBounds.max.y = Math.max(sceneBounds.max.y, a.aabb.max.y);
      sceneBounds.max.z = Math.max(sceneBounds.max.z, a.aabb.max.z);
    }

    const result = {
      analyzedAt: new Date().toISOString(),
      anchorCount: anchors.length,
      anchors: processed,
      spatialGrid: {
        cellSize: gridCellSize,
        occupiedCells: Object.keys(grid).length,
        grid,
      },
      proximityPairs,
      occlusionZones,
      surfaceClassification: surfaceSummary,
      sceneBounds,
      sceneVolume: Math.round(
        (sceneBounds.max.x - sceneBounds.min.x) *
        (sceneBounds.max.y - sceneBounds.min.y) *
        (sceneBounds.max.z - sceneBounds.min.z) * 10000
      ) / 10000,
    };

    artifact.data.spatialMapping = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * markerDetection
   * Analyze marker patterns — compute Hamming distances between marker codes,
   * validate marker integrity, estimate pose from corner positions.
   * artifact.data.markers: [{ id, code: number|string (binary), corners?: [{x,y}], size? }]
   * params.codeLength — expected code bit length (default 16)
   * params.minHammingDistance — minimum Hamming distance for valid set (default 4)
   */
  registerLensAction("ar", "markerDetection", (ctx, artifact, params) => {
  try {
    const markers = artifact.data.markers || [];
    if (markers.length === 0) {
      return { ok: true, result: { message: "No markers provided for analysis." } };
    }

    const codeLength = params.codeLength || 16;
    const minHammingDist = params.minHammingDistance || 4;

    // Convert codes to binary strings
    const markerData = markers.map(m => {
      let binary;
      if (typeof m.code === "number") {
        binary = m.code.toString(2).padStart(codeLength, "0");
      } else {
        binary = String(m.code).padStart(codeLength, "0");
      }
      return { ...m, binary: binary.slice(0, codeLength) };
    });

    // Hamming distance computation
    function hamming(a, b) {
      let dist = 0;
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) dist++;
      }
      return dist;
    }

    // Compute all pairwise Hamming distances
    const hammingDistances = [];
    let minDist = Infinity;
    let maxDist = 0;

    for (let i = 0; i < markerData.length; i++) {
      for (let j = i + 1; j < markerData.length; j++) {
        const dist = hamming(markerData[i].binary, markerData[j].binary);
        minDist = Math.min(minDist, dist);
        maxDist = Math.max(maxDist, dist);
        hammingDistances.push({
          markerA: markerData[i].id,
          markerB: markerData[j].id,
          distance: dist,
          isDistinguishable: dist >= minHammingDist,
        });
      }
    }

    // Validate code integrity: check for balanced bit distribution, rotation uniqueness
    const validationResults = markerData.map(m => {
      const ones = m.binary.split("").filter(b => b === "1").length;
      const zeros = codeLength - ones;
      const bitBalance = Math.round((Math.min(ones, zeros) / Math.max(ones, zeros, 1)) * 1000) / 1000;

      // Check rotational uniqueness (90-degree rotations for square markers)
      // Treat code as sqrt(codeLength) x sqrt(codeLength) grid
      const gridSize = Math.round(Math.sqrt(codeLength));
      const rotations = new Set();
      if (gridSize * gridSize === codeLength) {
        let current = m.binary;
        for (let r = 0; r < 4; r++) {
          rotations.add(current);
          // Rotate 90 degrees clockwise
          let rotated = "";
          for (let col = 0; col < gridSize; col++) {
            for (let row = gridSize - 1; row >= 0; row--) {
              rotated += current[row * gridSize + col];
            }
          }
          current = rotated;
        }
      }

      return {
        id: m.id,
        code: m.binary,
        onesCount: ones,
        zerosCount: zeros,
        bitBalance,
        isBalanced: bitBalance >= 0.3,
        rotationallyUnique: rotations.size === 4,
        rotationCount: rotations.size,
      };
    });

    // Pose estimation from corners (if provided)
    const poseEstimates = markerData
      .filter(m => m.corners && m.corners.length === 4)
      .map(m => {
        const corners = m.corners;
        const markerSize = m.size || 1.0;

        // Compute perimeter
        let perimeter = 0;
        for (let i = 0; i < 4; i++) {
          const next = (i + 1) % 4;
          const dx = corners[next].x - corners[i].x;
          const dy = corners[next].y - corners[i].y;
          perimeter += Math.sqrt(dx * dx + dy * dy);
        }

        // Compute area using Shoelace formula
        let area = 0;
        for (let i = 0; i < 4; i++) {
          const next = (i + 1) % 4;
          area += corners[i].x * corners[next].y;
          area -= corners[next].x * corners[i].y;
        }
        area = Math.abs(area) / 2;

        // Estimate distance from apparent size (pinhole camera model approximation)
        const apparentSize = Math.sqrt(area);
        const estimatedDistance = apparentSize > 0 ? Math.round((markerSize / apparentSize) * 100 * 1000) / 1000 : null;

        // Center point
        const center = {
          x: Math.round((corners.reduce((s, c) => s + c.x, 0) / 4) * 1000) / 1000,
          y: Math.round((corners.reduce((s, c) => s + c.y, 0) / 4) * 1000) / 1000,
        };

        // Estimate rotation from corner arrangement
        const dx = corners[1].x - corners[0].x;
        const dy = corners[1].y - corners[0].y;
        const angle = Math.round((Math.atan2(dy, dx) * 180 / Math.PI) * 100) / 100;

        // Compute aspect ratio of projected quad (perspective distortion indicator)
        const side1 = Math.sqrt(Math.pow(corners[1].x - corners[0].x, 2) + Math.pow(corners[1].y - corners[0].y, 2));
        const side2 = Math.sqrt(Math.pow(corners[2].x - corners[1].x, 2) + Math.pow(corners[2].y - corners[1].y, 2));
        const aspectRatio = side2 > 0 ? Math.round((side1 / side2) * 1000) / 1000 : 0;
        const perspectiveDistortion = Math.round(Math.abs(1 - aspectRatio) * 1000) / 1000;

        return {
          id: m.id,
          center,
          area: Math.round(area * 1000) / 1000,
          perimeter: Math.round(perimeter * 1000) / 1000,
          estimatedDistance,
          rotationDeg: angle,
          aspectRatio,
          perspectiveDistortion,
        };
      });

    const confusablePairs = hammingDistances.filter(h => !h.isDistinguishable);
    const setValid = confusablePairs.length === 0;

    const result = {
      analyzedAt: new Date().toISOString(),
      markerCount: markers.length,
      codeLength,
      minHammingDistance: minDist === Infinity ? 0 : minDist,
      maxHammingDistance: maxDist,
      requiredMinDistance: minHammingDist,
      setIsValid: setValid,
      confusablePairs,
      hammingDistances,
      validation: validationResults,
      poseEstimates,
    };

    artifact.data.markerDetection = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * sceneGraph
   * Build and analyze a 3D scene graph — compute transform hierarchies,
   * detect overlapping objects, measure scene complexity.
   * artifact.data.nodes: [{ id, parentId?, position: {x,y,z}, rotation?: {x,y,z}, scale?: {x,y,z}, type?, meshVertexCount? }]
   */
  registerLensAction("ar", "sceneGraph", (ctx, artifact, params) => {
  try {
    const nodes = artifact.data.nodes || [];
    if (nodes.length === 0) {
      return { ok: true, result: { message: "No scene graph nodes provided." } };
    }

    // Build parent-child map
    const nodeMap = {};
    const children = {};
    const roots = [];

    for (const node of nodes) {
      nodeMap[node.id] = node;
      children[node.id] = [];
    }
    for (const node of nodes) {
      if (node.parentId && nodeMap[node.parentId]) {
        children[node.parentId].push(node.id);
      } else {
        roots.push(node.id);
      }
    }

    // Compute world transforms by traversing the hierarchy
    const worldTransforms = {};

    function computeWorldTransform(nodeId, parentWorldPos, parentWorldScale) {
      const node = nodeMap[nodeId];
      const localPos = node.position || { x: 0, y: 0, z: 0 };
      const localScale = node.scale || { x: 1, y: 1, z: 1 };

      // Simplified transform: position accumulates, scale multiplies
      const worldPos = {
        x: parentWorldPos.x + localPos.x * parentWorldScale.x,
        y: parentWorldPos.y + localPos.y * parentWorldScale.y,
        z: parentWorldPos.z + localPos.z * parentWorldScale.z,
      };
      const worldScale = {
        x: parentWorldScale.x * localScale.x,
        y: parentWorldScale.y * localScale.y,
        z: parentWorldScale.z * localScale.z,
      };

      worldTransforms[nodeId] = {
        position: {
          x: Math.round(worldPos.x * 10000) / 10000,
          y: Math.round(worldPos.y * 10000) / 10000,
          z: Math.round(worldPos.z * 10000) / 10000,
        },
        scale: {
          x: Math.round(worldScale.x * 10000) / 10000,
          y: Math.round(worldScale.y * 10000) / 10000,
          z: Math.round(worldScale.z * 10000) / 10000,
        },
        rotation: node.rotation || { x: 0, y: 0, z: 0 },
      };

      for (const childId of children[nodeId]) {
        computeWorldTransform(childId, worldPos, worldScale);
      }
    }

    const originPos = { x: 0, y: 0, z: 0 };
    const unitScale = { x: 1, y: 1, z: 1 };
    for (const rootId of roots) {
      computeWorldTransform(rootId, originPos, unitScale);
    }

    // Compute tree depth for each node
    const depths = {};
    function computeDepth(nodeId, depth) {
      depths[nodeId] = depth;
      for (const childId of children[nodeId]) {
        computeDepth(childId, depth + 1);
      }
    }
    for (const rootId of roots) {
      computeDepth(rootId, 0);
    }

    const maxDepth = Math.max(...Object.values(depths), 0);

    // Detect overlapping objects using world-space proximity
    function dist3d(a, b) {
      return Math.sqrt(
        Math.pow(a.x - b.x, 2) +
        Math.pow(a.y - b.y, 2) +
        Math.pow(a.z - b.z, 2)
      );
    }

    const overlaps = [];
    const nodeIds = Object.keys(worldTransforms);
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = worldTransforms[nodeIds[i]];
        const b = worldTransforms[nodeIds[j]];
        const d = dist3d(a.position, b.position);
        // Consider objects overlapping if within combined scale radius
        const radiusA = (Math.abs(a.scale.x) + Math.abs(a.scale.y) + Math.abs(a.scale.z)) / 6;
        const radiusB = (Math.abs(b.scale.x) + Math.abs(b.scale.y) + Math.abs(b.scale.z)) / 6;
        if (d < radiusA + radiusB && d < 0.5) {
          overlaps.push({
            nodeA: nodeIds[i],
            nodeB: nodeIds[j],
            distance: Math.round(d * 10000) / 10000,
            combinedRadius: Math.round((radiusA + radiusB) * 10000) / 10000,
          });
        }
      }
    }

    // Scene complexity metrics
    const totalVertices = nodes.reduce((s, n) => s + (n.meshVertexCount || 0), 0);
    const typeCounts = {};
    for (const node of nodes) {
      const type = node.type || "unknown";
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }

    // Branching factor: average children per non-leaf node
    const nonLeaves = nodes.filter(n => children[n.id].length > 0);
    const avgBranchingFactor = nonLeaves.length > 0
      ? Math.round((nonLeaves.reduce((s, n) => s + children[n.id].length, 0) / nonLeaves.length) * 100) / 100
      : 0;

    // Leaf nodes count
    const leafCount = nodes.filter(n => children[n.id].length === 0).length;

    // Scene bounds from world transforms
    const sceneBounds = {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
    };
    for (const wt of Object.values(worldTransforms)) {
      sceneBounds.min.x = Math.min(sceneBounds.min.x, wt.position.x);
      sceneBounds.min.y = Math.min(sceneBounds.min.y, wt.position.y);
      sceneBounds.min.z = Math.min(sceneBounds.min.z, wt.position.z);
      sceneBounds.max.x = Math.max(sceneBounds.max.x, wt.position.x);
      sceneBounds.max.y = Math.max(sceneBounds.max.y, wt.position.y);
      sceneBounds.max.z = Math.max(sceneBounds.max.z, wt.position.z);
    }

    const result = {
      analyzedAt: new Date().toISOString(),
      totalNodes: nodes.length,
      rootCount: roots.length,
      roots,
      maxDepth,
      leafCount,
      avgBranchingFactor,
      totalVertices,
      typeCounts,
      worldTransforms,
      overlappingPairs: overlaps,
      sceneBounds: nodes.length > 0 ? sceneBounds : null,
      complexity: {
        nodeCount: nodes.length,
        depthScore: maxDepth,
        branchingScore: avgBranchingFactor,
        vertexScore: totalVertices,
        overlapCount: overlaps.length,
        // Composite complexity: weighted combination
        composite: Math.round((
          nodes.length * 1 +
          maxDepth * 5 +
          avgBranchingFactor * 3 +
          Math.log2(totalVertices + 1) * 2 +
          overlaps.length * 10
        ) * 100) / 100,
      },
    };

    artifact.data.sceneGraph = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ---------------------------------------------------------------------------
  // AR scene-authoring substrate (Adobe Aero / Niantic Studio parity).
  // Persistent per-user data lives in globalThis._concordSTATE.arLens.
  // ---------------------------------------------------------------------------

  /** Lazily provision the per-domain state container. */
  function arState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.arLens) {
      STATE.arLens = {
        scenes: new Map(),    // userId -> Map<sceneId, scene>
        targets: new Map(),   // userId -> Map<targetId, imageTarget>
        publishes: new Map(), // userId -> Map<publishId, publishRecord>
      };
    }
    return STATE.arLens;
  }

  /** Resolve the calling user's id from ctx, defaulting to a shared bucket. */
  function userIdOf(ctx) {
    return (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "anon";
  }

  /** Per-user Map accessor that auto-creates the bucket. */
  function bucket(map, uid) {
    if (!map.has(uid)) map.set(uid, new Map());
    return map.get(uid);
  }

  // ── DB-backed per-user store (migration 332) ───────────────────────────────
  // Returns a Map-like facade ({ get, set, delete, values, size }) over an
  // ar_* table so authored AR scenes/targets/publishes survive a restart. When
  // ctx.db is absent or the table doesn't exist (minimal/test builds), it falls
  // back transparently to the in-memory globalThis bucket. The macros call only
  // get/set/delete/values()/size, so the facade is a drop-in for `bucket(...)`.
  function dbStore(ctx, table, memMap) {
    const db = ctx && ctx.db;
    const uid = userIdOf(ctx);
    if (!db) return bucket(memMap, uid);
    try { db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(); }
    catch { return bucket(memMap, uid); }
    return {
      get(id) {
        const r = db.prepare(`SELECT data_json FROM ${table} WHERE user_id = ? AND id = ?`).get(uid, id);
        return r ? JSON.parse(r.data_json) : undefined;
      },
      set(id, val) {
        const createdAt = (val && val.createdAt) || new Date().toISOString();
        const updatedAt = (val && val.updatedAt) || createdAt;
        db.prepare(
          `INSERT INTO ${table} (id, user_id, data_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
        ).run(id, uid, JSON.stringify(val), createdAt, updatedAt);
        return val;
      },
      delete(id) {
        return db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND id = ?`).run(uid, id).changes > 0;
      },
      values() {
        return db.prepare(`SELECT data_json FROM ${table} WHERE user_id = ? ORDER BY updated_at DESC`)
          .all(uid).map((r) => JSON.parse(r.data_json));
      },
      get size() {
        return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(uid).n;
      },
    };
  }

  const sceneStore = (ctx) => dbStore(ctx, "ar_scenes", arState().scenes);
  const targetStore = (ctx) => dbStore(ctx, "ar_image_targets", arState().targets);
  const publishStore = (ctx) => dbStore(ctx, "ar_publishes", arState().publishes);

  function rid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function clampNum(v, lo, hi, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  const VALID_TRIGGERS = ["tap", "proximity", "scene_start", "anchor_found", "timer", "gaze"];
  const VALID_ACTIONS = ["play_animation", "play_audio", "show", "hide", "transform", "navigate", "emit_signal"];
  const VALID_ANCHORS = ["plane", "point", "image", "face", "object", "geo", "world_origin"];

  /**
   * buildRenderPlan — the deterministic WebXR render descriptor for a set of AR objects.
   * Shared by `webxrPreview` (session-plan preview) and `render` (the lens render button).
   * Computes immersive-ar required/optional features from the objects + anchor, and a
   * draw-order-sorted draw list (opaque first, transparent last).
   */
  function buildRenderPlan(objects, anchor, settings) {
    objects = Array.isArray(objects) ? objects : [];
    anchor = anchor || "plane";
    settings = settings || {};
    const requiredFeatures = ["local-floor"];
    const optionalFeatures = ["dom-overlay", "light-estimation"];
    if (anchor === "plane" || settings.planeDetection !== false) requiredFeatures.push("plane-detection");
    if (anchor === "image") optionalFeatures.push("image-tracking");
    if (objects.some((o) => o.occlusion && o.occlusion.enabled)) optionalFeatures.push("depth-sensing");
    if (objects.some((o) => o.kind === "anchor" || anchor === "geo")) optionalFeatures.push("anchors");

    const drawList = objects
      .map((o) => ({
        id: o.id,
        kind: o.kind,
        model: o.model || o.primitive || null,
        transform: { position: o.position, rotation: o.rotation, scale: o.scale },
        opacity: o.opacity != null ? o.opacity : 1,
        physics: o.physics ? o.physics.body : "static",
        occlusion: !!(o.occlusion && o.occlusion.enabled),
        color: o.color || "#a855f7",
      }))
      .sort((a, b) => (a.opacity >= 1 ? 0 : 1) - (b.opacity >= 1 ? 0 : 1));

    return {
      sessionMode: "immersive-ar",
      requiredFeatures,
      optionalFeatures,
      fallback: "screen-ar", // when immersive-ar is unsupported
      referenceSpace: "local-floor",
      anchor,
      drawList,
      objectCount: drawList.length,
      renderQuality: settings.renderQuality || "high",
      estimatedDrawCalls: drawList.length + (drawList.some((d) => d.occlusion) ? 1 : 0),
    };
  }

  /** Parse a "x,y,z" string (the AR lens form shape) or a {x,y,z} object into a vec3. */
  function parseVec3(v, fallback) {
    if (v && typeof v === "object") return v;
    if (typeof v === "string" && v.trim()) {
      const parts = v.split(",").map((x) => Number(x.trim()));
      if (parts.length === 3 && parts.every(Number.isFinite)) return { x: parts[0], y: parts[1], z: parts[2] };
    }
    return fallback || { x: 0, y: 0, z: 0 };
  }

  /** Synthesize a single renderable object from a lens artifact's flat form fields. */
  function objectFromArtifact(artifact, d) {
    return {
      id: (artifact && artifact.id) || "obj",
      name: d.name || (artifact && artifact.title) || "object",
      kind: artifact && artifact.type ? String(artifact.type).toLowerCase() : "model",
      model: d.model || d.format || null,
      primitive: "box",
      position: parseVec3(d.position),
      rotation: parseVec3(d.rotation),
      scale: Number(d.scale) || 1,
      opacity: d.opacity != null ? clampNum(d.opacity, 0, 100, 100) / 100 : 1,
      color: d.color || "#a855f7",
      occlusion: d.occlusion ? { enabled: true } : undefined,
    };
  }

  /** AABB + center from a draw list's transform positions (null when empty). */
  function computeBounds(drawList) {
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const dr of drawList) {
      const p = dr.transform && dr.transform.position;
      if (!p) continue;
      min.x = Math.min(min.x, p.x || 0); min.y = Math.min(min.y, p.y || 0); min.z = Math.min(min.z, p.z || 0);
      max.x = Math.max(max.x, p.x || 0); max.y = Math.max(max.y, p.y || 0); max.z = Math.max(max.z, p.z || 0);
    }
    if (!Number.isFinite(min.x)) return null;
    return { min, max, center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 } };
  }

  /**
   * sceneSave
   * Create or update a full AR authoring scene (objects + behaviors + anchors).
   * params.scene: { id?, name, anchor?, objects:[{id,name,kind,model?,position,rotation,scale,
   *   physics?,occlusion?,opacity?}], behaviors:[{id,trigger,triggerParams?,action,actionParams?,targetId}],
   *   audio?:[{id,position,clipUrl,radius,volume,loop}], settings? }
   */
  registerLensAction("ar", "sceneSave", (ctx, artifact, params) => {
    try {
      const scenes = sceneStore(ctx);
      const input = (params && params.scene) || {};
      if (!input.name || typeof input.name !== "string") {
        return { ok: false, error: "scene.name is required" };
      }
      const now = new Date().toISOString();
      const existing = input.id ? scenes.get(input.id) : null;
      const id = existing ? existing.id : rid("arscene");

      const objects = Array.isArray(input.objects) ? input.objects : [];
      const normObjects = objects.map((o) => ({
        id: o.id || rid("obj"),
        name: o.name || "Object",
        kind: o.kind || "model", // model | primitive | sprite | text | light
        model: o.model || null,
        primitive: o.primitive || (o.kind === "primitive" ? "box" : null),
        position: o.position || { x: 0, y: 0, z: 0 },
        rotation: o.rotation || { x: 0, y: 0, z: 0 },
        scale: o.scale || { x: 1, y: 1, z: 1 },
        color: o.color || "#a855f7",
        opacity: clampNum(o.opacity, 0, 1, 1),
        physics: {
          enabled: !!(o.physics && o.physics.enabled),
          body: (o.physics && o.physics.body) || "static", // static | dynamic | kinematic
          mass: clampNum(o.physics && o.physics.mass, 0, 1000, 1),
          restitution: clampNum(o.physics && o.physics.restitution, 0, 1, 0.2),
        },
        occlusion: {
          enabled: !!(o.occlusion && o.occlusion.enabled),
          castShadow: o.occlusion ? o.occlusion.castShadow !== false : true,
          receiveShadow: o.occlusion ? o.occlusion.receiveShadow !== false : true,
        },
        animation: o.animation || null, // { clip, autoplay, loop }
        visible: o.visible !== false,
      }));

      const behaviors = Array.isArray(input.behaviors) ? input.behaviors : [];
      const normBehaviors = behaviors.map((b) => ({
        id: b.id || rid("bhv"),
        name: b.name || `${b.trigger || "tap"} → ${b.action || "play_animation"}`,
        trigger: VALID_TRIGGERS.includes(b.trigger) ? b.trigger : "tap",
        triggerParams: b.triggerParams || {},
        action: VALID_ACTIONS.includes(b.action) ? b.action : "play_animation",
        actionParams: b.actionParams || {},
        targetId: b.targetId || null,
        enabled: b.enabled !== false,
      }));

      const audio = Array.isArray(input.audio) ? input.audio : [];
      const normAudio = audio.map((a) => ({
        id: a.id || rid("aud"),
        name: a.name || "Spatial Audio",
        position: a.position || { x: 0, y: 0, z: 0 },
        clipUrl: a.clipUrl || null,
        radius: clampNum(a.radius, 0.1, 100, 5),
        volume: clampNum(a.volume, 0, 1, 0.8),
        loop: a.loop !== false,
        rolloff: a.rolloff || "linear", // linear | inverse | exponential
      }));

      const scene = {
        id,
        name: input.name,
        anchor: VALID_ANCHORS.includes(input.anchor) ? input.anchor : "plane",
        objects: normObjects,
        behaviors: normBehaviors,
        audio: normAudio,
        settings: {
          trackingMode: (input.settings && input.settings.trackingMode) || "world",
          renderQuality: (input.settings && input.settings.renderQuality) || "high",
          environmentLighting: input.settings ? input.settings.environmentLighting !== false : true,
          planeDetection: input.settings ? input.settings.planeDetection !== false : true,
          scale: clampNum(input.settings && input.settings.scale, 0.01, 100, 1),
        },
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        version: existing ? existing.version + 1 : 1,
      };
      scenes.set(id, scene);
      return { ok: true, result: { scene, saved: true } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /** sceneList — list the caller's authored scenes (summary form). */
  registerLensAction("ar", "sceneList", (ctx) => {
    try {
      const scenes = sceneStore(ctx);
      const list = [...scenes.values()]
        .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
        .map((s) => ({
          id: s.id,
          name: s.name,
          anchor: s.anchor,
          objectCount: s.objects.length,
          behaviorCount: s.behaviors.length,
          audioCount: s.audio.length,
          version: s.version,
          updatedAt: s.updatedAt,
        }));
      return { ok: true, result: { scenes: list, count: list.length } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /** sceneGet — fetch one full scene by id. */
  registerLensAction("ar", "sceneGet", (ctx, artifact, params) => {
    try {
      const scenes = sceneStore(ctx);
      const id = params && params.sceneId;
      if (!id) return { ok: false, error: "sceneId is required" };
      const scene = scenes.get(id);
      if (!scene) return { ok: false, error: "scene not found" };
      return { ok: true, result: { scene } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /** sceneDelete — remove a scene the caller owns. */
  registerLensAction("ar", "sceneDelete", (ctx, artifact, params) => {
    try {
      const scenes = sceneStore(ctx);
      const id = params && params.sceneId;
      if (!id) return { ok: false, error: "sceneId is required" };
      const existed = scenes.delete(id);
      return { ok: true, result: { deleted: existed, sceneId: id } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * behaviorValidate
   * Static-analyse a scene's interactive behaviors / triggers — verify every
   * behavior targets a real object, flag unreachable triggers, summarise the
   * trigger→action graph that the WebXR runtime will execute.
   * params: { sceneId } OR { objects, behaviors }
   */
  registerLensAction("ar", "behaviorValidate", (ctx, artifact, params) => {
    try {
      const p = params || {};
      let objects = p.objects;
      let behaviors = p.behaviors;
      if (p.sceneId) {
        const scene = sceneStore(ctx).get(p.sceneId);
        if (!scene) return { ok: false, error: "scene not found" };
        objects = scene.objects;
        behaviors = scene.behaviors;
      }
      objects = Array.isArray(objects) ? objects : [];
      behaviors = Array.isArray(behaviors) ? behaviors : [];

      const objIds = new Set(objects.map((o) => o.id));
      const issues = [];
      const graph = [];
      const triggerCounts = {};
      const actionCounts = {};

      for (const b of behaviors) {
        const tgt = b.targetId;
        if (tgt && !objIds.has(tgt)) {
          issues.push({ behaviorId: b.id, severity: "error", message: `targetId '${tgt}' references no object` });
        }
        if (!VALID_TRIGGERS.includes(b.trigger)) {
          issues.push({ behaviorId: b.id, severity: "error", message: `unknown trigger '${b.trigger}'` });
        }
        if (!VALID_ACTIONS.includes(b.action)) {
          issues.push({ behaviorId: b.id, severity: "error", message: `unknown action '${b.action}'` });
        }
        if (b.action === "play_animation" && tgt) {
          const obj = objects.find((o) => o.id === tgt);
          if (obj && !obj.animation) {
            issues.push({ behaviorId: b.id, severity: "warning", message: `play_animation targets '${tgt}' which has no animation clip` });
          }
        }
        if (b.trigger === "proximity" && !(b.triggerParams && b.triggerParams.radius)) {
          issues.push({ behaviorId: b.id, severity: "warning", message: "proximity trigger has no radius — defaults to 1m" });
        }
        triggerCounts[b.trigger] = (triggerCounts[b.trigger] || 0) + 1;
        actionCounts[b.action] = (actionCounts[b.action] || 0) + 1;
        graph.push({ behaviorId: b.id, trigger: b.trigger, action: b.action, targetId: tgt || null });
      }

      // Objects with no behavior attached (purely decorative — informational).
      const targeted = new Set(behaviors.map((b) => b.targetId).filter(Boolean));
      const inertObjects = objects.filter((o) => !targeted.has(o.id)).map((o) => o.id);

      const errors = issues.filter((i) => i.severity === "error").length;
      return {
        ok: true,
        result: {
          valid: errors === 0,
          behaviorCount: behaviors.length,
          objectCount: objects.length,
          issues,
          errorCount: errors,
          warningCount: issues.length - errors,
          triggerCounts,
          actionCounts,
          graph,
          inertObjects,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * animationTimeline
   * Compile per-object animation keyframes into a sorted, validated timeline —
   * computes total duration, detects overlapping clips, emits a sampled track
   * for the editor scrubber.
   * params.tracks: [{ objectId, property:'position'|'rotation'|'scale'|'opacity',
   *   keyframes:[{ t, value }], easing? }]
   * params.fps (default 30)
   */
  registerLensAction("ar", "animationTimeline", (ctx, artifact, params) => {
    try {
      const p = params || {};
      const tracks = Array.isArray(p.tracks) ? p.tracks : [];
      if (tracks.length === 0) {
        return { ok: true, result: { duration: 0, tracks: [], frameCount: 0, message: "No animation tracks." } };
      }
      const fps = clampNum(p.fps, 1, 120, 30);
      let duration = 0;
      const compiled = tracks.map((tr) => {
        const kfs = (Array.isArray(tr.keyframes) ? tr.keyframes : [])
          .map((k) => ({ t: clampNum(k.t, 0, 86400, 0), value: k.value }))
          .sort((a, b) => a.t - b.t);
        const trackEnd = kfs.length ? kfs[kfs.length - 1].t : 0;
        duration = Math.max(duration, trackEnd);
        return {
          objectId: tr.objectId || rid("trk"),
          property: tr.property || "position",
          easing: tr.easing || "linear",
          keyframes: kfs,
          keyframeCount: kfs.length,
          trackDuration: trackEnd,
        };
      });

      // Detect timeline overlaps on the same (objectId, property) pair.
      const overlaps = [];
      for (let i = 0; i < compiled.length; i++) {
        for (let j = i + 1; j < compiled.length; j++) {
          const a = compiled[i], b = compiled[j];
          if (a.objectId === b.objectId && a.property === b.property) {
            overlaps.push({ trackA: i, trackB: j, objectId: a.objectId, property: a.property });
          }
        }
      }

      const frameCount = Math.ceil(duration * fps);
      // Sample one representative track for a scrubber preview.
      const sampledTrack = compiled[0]
        ? Array.from({ length: Math.min(frameCount + 1, 240) }, (_, f) => {
            const t = f / fps;
            const kfs = compiled[0].keyframes;
            let active = kfs[0] || null;
            for (const k of kfs) { if (k.t <= t) active = k; }
            return { frame: f, t: Math.round(t * 1000) / 1000, value: active ? active.value : null };
          })
        : [];

      return {
        ok: true,
        result: {
          duration: Math.round(duration * 1000) / 1000,
          fps,
          frameCount,
          trackCount: compiled.length,
          tracks: compiled,
          overlaps,
          hasOverlaps: overlaps.length > 0,
          sampledTrack,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * imageTargetCompile
   * Compile an uploaded image into an AR image-target — scores trackability
   * from feature-density heuristics, derives the physical anchor footprint,
   * persists the target for reuse.
   * params: { name, width, height, physicalWidthCm?, featurePoints?, contrastScore?, sceneId? }
   */
  registerLensAction("ar", "imageTargetCompile", (ctx, artifact, params) => {
    try {
      const p = params || {};
      if (!p.name) return { ok: false, error: "name is required" };
      const w = clampNum(p.width, 1, 16384, 1024);
      const h = clampNum(p.height, 1, 16384, 1024);
      const megapixels = (w * h) / 1e6;
      const aspect = Math.round((w / h) * 1000) / 1000;

      // Trackability heuristic: feature density + contrast, penalise extreme aspect.
      const featurePoints = clampNum(p.featurePoints, 0, 100000, Math.round(megapixels * 280));
      const contrast = clampNum(p.contrastScore, 0, 1, 0.65);
      const density = featurePoints / Math.max(megapixels, 0.01);
      let score = Math.min(1, (Math.min(density / 600, 1) * 0.55) + (contrast * 0.35) + 0.1);
      const aspectPenalty = aspect > 3 || aspect < 0.33 ? 0.25 : 0;
      score = Math.max(0, score - aspectPenalty);
      score = Math.round(score * 100) / 100;

      let rating = "poor";
      if (score >= 0.8) rating = "excellent";
      else if (score >= 0.6) rating = "good";
      else if (score >= 0.4) rating = "fair";

      const warnings = [];
      if (featurePoints < 150) warnings.push("Low feature count — add visual detail or texture.");
      if (contrast < 0.4) warnings.push("Low contrast — image may track poorly in dim light.");
      if (aspectPenalty > 0) warnings.push("Extreme aspect ratio reduces tracking stability.");

      const physicalWidthCm = clampNum(p.physicalWidthCm, 1, 1000, 20);
      const physicalHeightCm = Math.round((physicalWidthCm / aspect) * 100) / 100;

      const target = {
        id: rid("imgt"),
        name: p.name,
        width: w,
        height: h,
        aspect,
        megapixels: Math.round(megapixels * 100) / 100,
        featurePoints,
        trackabilityScore: score,
        rating,
        warnings,
        physical: { widthCm: physicalWidthCm, heightCm: physicalHeightCm },
        sceneId: p.sceneId || null,
        compiledAt: new Date().toISOString(),
      };
      targetStore(ctx).set(target.id, target);
      return { ok: true, result: { target } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /** imageTargetList — list the caller's compiled image targets. */
  registerLensAction("ar", "imageTargetList", (ctx) => {
    try {
      const targets = targetStore(ctx);
      return { ok: true, result: { targets: [...targets.values()], count: targets.size } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * publishScene
   * Generate a shareable publish record for an AR scene — a short link,
   * QR-encodable payload, and a WebXR-capability summary so a phone can open it.
   * params: { sceneId, baseUrl?, expiresInHours? }
   */
  registerLensAction("ar", "publishScene", (ctx, artifact, params) => {
    try {
      const p = params || {};
      if (!p.sceneId) return { ok: false, error: "sceneId is required" };
      const scene = sceneStore(ctx).get(p.sceneId);
      if (!scene) return { ok: false, error: "scene not found" };

      const slug = rid("p").slice(2);
      const baseUrl = (typeof p.baseUrl === "string" && p.baseUrl) || "https://concord-os.org";
      const url = `${baseUrl.replace(/\/$/, "")}/ar/view/${slug}`;
      const now = Date.now();
      const expiresInHours = clampNum(p.expiresInHours, 1, 8760, 720);
      const record = {
        id: rid("pub"),
        slug,
        sceneId: scene.id,
        sceneName: scene.name,
        url,
        // QR payload is the URL itself — the frontend renders it to a QR canvas.
        qrPayload: url,
        anchor: scene.anchor,
        objectCount: scene.objects.length,
        requiresWebXR: scene.settings.trackingMode !== "screen",
        markerBased: scene.anchor === "image",
        publishedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + expiresInHours * 3600 * 1000).toISOString(),
        version: scene.version,
      };
      publishStore(ctx).set(record.id, record);
      return { ok: true, result: { publish: record } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * webxrPreview
   * Produce a deterministic WebXR session plan for a scene — what session
   * features to request, fallbacks, and a draw list the live camera preview
   * renders. Pure compute; safe to call before a WebXR session exists.
   * params: { sceneId } OR { objects, anchor, settings }
   */
  registerLensAction("ar", "webxrPreview", (ctx, artifact, params) => {
    try {
      const p = params || {};
      let objects, anchor, settings;
      if (p.sceneId) {
        const scene = sceneStore(ctx).get(p.sceneId);
        if (!scene) return { ok: false, error: "scene not found" };
        objects = scene.objects;
        anchor = scene.anchor;
        settings = scene.settings;
      } else {
        objects = Array.isArray(p.objects) ? p.objects : [];
        anchor = p.anchor || "plane";
        settings = p.settings || {};
      }

      return { ok: true, result: buildRenderPlan(objects, anchor, settings) };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * render — the AR lens "render" button. Produces a deterministic render descriptor for
   * a scene/layer/model artifact that the frontend drives into the existing Three.js
   * viewport (inline) or, when the device supports it, an immersive-ar WebXR session
   * (the SceneStudio path). Resolves objects from: an explicit sceneId (arState scenes),
   * else the artifact's own `objects[]`, else a single renderable synthesized from the
   * artifact's flat form fields. Never throws.
   */
  registerLensAction("ar", "render", (ctx, artifact, params = {}) => {
    try {
      const p = params || {};
      const d = (artifact && artifact.data) || {};
      let objects, anchor, settings;

      if (p.sceneId) {
        const scene = sceneStore(ctx).get(p.sceneId);
        if (scene) { objects = scene.objects; anchor = scene.anchor; settings = scene.settings; }
      }
      if (!objects) {
        if (Array.isArray(d.objects) && d.objects.length) {
          objects = d.objects; anchor = anchor || d.anchor; settings = settings || d.settings;
        } else if (Array.isArray(p.objects) && p.objects.length) {
          objects = p.objects; anchor = anchor || p.anchor; settings = settings || p.settings;
        } else {
          objects = [objectFromArtifact(artifact, d)];
        }
      }
      anchor = anchor || d.anchorType || d.anchor || "plane";
      settings = settings || { renderQuality: d.renderQuality };

      const plan = buildRenderPlan(objects, anchor, settings);
      // Model URLs to pre-warm the GLTF LRU cache (asset-loader.ts) before the session.
      const assets = [...new Set(
        plan.drawList.map((x) => x.model).filter((m) => typeof m === "string" && /[./]/.test(m))
      )];

      return {
        ok: true,
        result: {
          ...plan,
          // The client feature-detects navigator.xr.isSessionSupported('immersive-ar');
          // when unsupported it downgrades to the inline orbit viewport (a real render).
          inlineFallback: true,
          renderTarget: "ar-viewport",
          assets,
          bounds: computeBounds(plan.drawList),
          artifactId: artifact ? artifact.id : null,
          title: (artifact && artifact.title) || d.name || "AR scene",
        },
      };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e && e.message || e) };
    }
  });
}
