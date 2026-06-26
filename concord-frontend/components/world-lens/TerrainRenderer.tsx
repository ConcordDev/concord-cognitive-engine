'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { getDeltaAt as getTerrainDeltaAt } from '@/lib/world-lens/terrain-deform-store';

// ── Types ──────────────────────────────────────────────────────────

export type TerrainZone =
  | 'cobblestone'  // Docks district
  | 'asphalt'      // Roads
  | 'brick'        // Exchange district
  | 'grass'        // Commons / Academy
  | 'gravel'       // Forge district
  | 'wild_grass'   // Frontier
  | 'dirt'         // Paths
  | 'sand';        // River banks

export interface DistrictZone {
  id: string;
  name: string;
  zone: TerrainZone;
  /** Bounding box in world coordinates [minX, minZ, maxX, maxZ] */
  bounds: [number, number, number, number];
}

export interface HeightmapData {
  /** Flat Float32Array of heights, row-major */
  data: Float32Array;
  width: number;
  height: number;
  /** World-space scale: how many meters per heightmap cell */
  cellSize: number;
  /** Maximum elevation in meters */
  maxElevation: number;
}

interface LODLevel {
  distance: number;   // Max distance from camera for this LOD
  segments: number;    // Grid subdivision count
}

interface TerrainRendererProps {
  heightmap?: HeightmapData;
  districts: DistrictZone[];
  /** World position of the camera/LOD center */
  lodCenter: { x: number; z: number };
  quality: 'low' | 'medium' | 'high' | 'ultra';
}

// ── Constants ─────────────────────────────────────────────────────

const LOD_LEVELS: LODLevel[] = [
  { distance: 100, segments: 128 },   // High detail within 100m
  { distance: 500, segments: 64 },    // Medium detail 100-500m
  { distance: Infinity, segments: 16 }, // Low detail 500m+
];

const TERRAIN_SIZE = 2000; // 2km x 2km world
const CHUNK_SIZE = 250;    // Each chunk is 250m x 250m

/** Zone material configuration for texture splatting */
const ZONE_MATERIALS: Record<TerrainZone, {
  color: number;
  roughness: number;
  metalness: number;
  bumpScale: number;
}> = {
  cobblestone: { color: 0x808080, roughness: 0.85, metalness: 0.0, bumpScale: 0.4 },
  asphalt:     { color: 0x3a3a3a, roughness: 0.9,  metalness: 0.0, bumpScale: 0.1 },
  brick:       { color: 0x8b4513, roughness: 0.75, metalness: 0.0, bumpScale: 0.3 },
  grass:       { color: 0x4a7c32, roughness: 0.95, metalness: 0.0, bumpScale: 0.15 },
  gravel:      { color: 0x9e9e8e, roughness: 0.92, metalness: 0.0, bumpScale: 0.35 },
  wild_grass:  { color: 0x5a8a3a, roughness: 0.95, metalness: 0.0, bumpScale: 0.2 },
  dirt:        { color: 0x8b7355, roughness: 0.88, metalness: 0.0, bumpScale: 0.2 },
  sand:        { color: 0xc2b280, roughness: 0.95, metalness: 0.0, bumpScale: 0.05 },
};

// ── Poughkeepsie Heightmap Generator ─────────────────────────────

/**
 * Generates a heightmap inspired by Poughkeepsie's geography:
 * - Low west edge (Hudson River, ~0m)
 * - Steep rise east from river (~30m over 200m)
 * - Flat plateau center (~40-50m)
 * - Rolling hills east (~50-80m)
 * - Fall Kill Creek valley cutting through (~20m depression)
 */
// Theme: deferred (procgen Simplex terrain). Replaces sine-wave-only
// per-vertex noise with seeded 4-octave fractal Simplex noise so the
// terrain actually looks like terrain — small ridges, irregular humps,
// no obvious sin() banding. The base west-to-east cross-section + creek
// valley remain sine/programmatic since they're authored landmarks
// (river bluff, central plateau, creek). Only the natural-feel
// perturbation switches to Simplex.
import { createSimplexNoise2D, octaveNoise2D } from '@/lib/world-lens/simplex-noise';
import { blendedBiomeWeights, type BiomeKind } from '@/lib/world-lens/biome-blend';
const TERRAIN_SEED = 0xc0ffee;
const _terrainNoise = createSimplexNoise2D(TERRAIN_SEED);

function generatePoughkeepsieHeightmap(width: number, height: number): Float32Array {
  const data = new Float32Array(width * height);
  const maxElev = 80;

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width;   // 0..1, west to east
      const nz = z / height;  // 0..1, south to north

      // Base elevation profile: west-to-east cross-section
      let elev = 0;

      // River zone (0-0.1): near sea level
      if (nx < 0.1) {
        elev = 2 + nx * 30;
      }
      // Steep rise (0.1-0.2): bluff from river
      else if (nx < 0.2) {
        const t = (nx - 0.1) / 0.1;
        elev = 5 + t * t * 35; // Quadratic rise
      }
      // Central plateau (0.2-0.6)
      else if (nx < 0.6) {
        // Simplex mid-frequency adds plateau lumpiness; was sin-band before.
        elev = 40 + octaveNoise2D(_terrainNoise, nx * 4, nz * 4, 3) * 5;
      }
      // Eastern hills (0.6-1.0)
      else {
        elev = 45 + (nx - 0.6) * 80;
        // Rolling hills via 4-octave Simplex (was layered sine waves).
        // Output ~[-1,1] × 8 = ±8m of natural-feeling height.
        elev += octaveNoise2D(_terrainNoise, nx * 6, nz * 6, 4) * 8;
      }

      // Fall Kill Creek valley: a depression running roughly SW to NE
      const creekCenterX = 0.35 + nz * 0.15;
      const distFromCreek = Math.abs(nx - creekCenterX);
      if (distFromCreek < 0.04) {
        const creekDepth = 12 * (1 - distFromCreek / 0.04);
        elev -= creekDepth;
      }

      // Minor terrain micro-noise for natural feel — Simplex at high
      // frequency keeps grass-mound scale variation without banding.
      elev += octaveNoise2D(_terrainNoise, nx * 60, nz * 60, 2) * 0.6;

      // Clamp and normalize
      elev = Math.max(0, Math.min(maxElev, elev));
      data[z * width + x] = elev / maxElev;
    }
  }

  return data;
}

// ── Terrain Control Map ──────────────────────────────────────────

/**
 * Generates a control map that assigns terrain zones per texel.
 * Returns an array of zone indices matching the heightmap dimensions.
 */
function generateControlMap(
  width: number,
  height: number,
  districts: DistrictZone[],
  terrainSize: number,
): Uint8Array {
  const zoneList = Object.keys(ZONE_MATERIALS) as TerrainZone[];
  const map = new Uint8Array(width * height);

  // Default to wild_grass
  const defaultIdx = zoneList.indexOf('wild_grass');
  map.fill(defaultIdx);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      // Convert heightmap coords to world coords
      const worldX = (x / width) * terrainSize - terrainSize / 2;
      const worldZ = (z / height) * terrainSize - terrainSize / 2;

      // Check each district zone
      for (const district of districts) {
        const [minX, minZ, maxX, maxZ] = district.bounds;
        if (worldX >= minX && worldX <= maxX && worldZ >= minZ && worldZ <= maxZ) {
          const idx = zoneList.indexOf(district.zone);
          if (idx !== -1) {
            map[z * width + x] = idx;
          }
          break; // First match wins
        }
      }
    }
  }

  return map;
}

// ── Component ────────────────────────────────────────────────────

export default function TerrainRenderer({
  heightmap: externalHeightmap,
  districts,
  lodCenter,
  quality,
}: TerrainRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terrainGroupRef = useRef<unknown>(null);
  const collisionMeshRef = useRef<unknown>(null);
  const heightmapDataRef = useRef<Float32Array | null>(null);
  const hmWidthRef = useRef(256);
  const hmHeightRef = useRef(256);

  // ── Elevation query function ──────────────────────────────────

  const getElevationAt = useCallback((worldX: number, worldZ: number): number => {
    const hm = heightmapDataRef.current;
    if (!hm) return 0;

    const w = hmWidthRef.current;
    const h = hmHeightRef.current;

    // World coords to heightmap coords
    const nx = (worldX + TERRAIN_SIZE / 2) / TERRAIN_SIZE;
    const nz = (worldZ + TERRAIN_SIZE / 2) / TERRAIN_SIZE;

    const ix = Math.max(0, Math.min(w - 1, Math.floor(nx * w)));
    const iz = Math.max(0, Math.min(h - 1, Math.floor(nz * h)));

    // Bilinear interpolation
    const fx = nx * w - ix;
    const fz = nz * h - iz;
    const ix1 = Math.min(ix + 1, w - 1);
    const iz1 = Math.min(iz + 1, h - 1);

    const h00 = hm[iz * w + ix];
    const h10 = hm[iz * w + ix1];
    const h01 = hm[iz1 * w + ix];
    const h11 = hm[iz1 * w + ix1];

    const top = h00 * (1 - fx) + h10 * fx;
    const bottom = h01 * (1 - fx) + h11 * fx;
    const elevation = top * (1 - fz) + bottom * fz;

    // WS-A3 — add the live deformation delta so the avatar Y-clamp + raycasts
    // sit on the DEFORMED surface (the store is base+delta's delta half; matches
    // the deformed mesh chunks + the rebuilt collider). 0 when undeformed.
    return elevation * 80 + getTerrainDeltaAt(worldX, worldZ); // maxElevation
  }, []);

  // Publish the ground sampler so other scene layers (NPCs, other players,
  // creatures) can plant themselves on the SAME surface the player walks (this
  // reads the actual heightmap the mesh + physics heightfield were built from,
  // incl. live deformation — so it's exact, not an approximation). Without this
  // those entities sit at their server Y (0) while the city plateau renders at
  // ~40m, i.e. buried under the world. Args are scene-frame coords.
  useEffect(() => {
    const w = window as unknown as { __concordiaSampleGroundY?: (x: number, z: number) => number | null };
    w.__concordiaSampleGroundY = (x: number, z: number) => {
      if (!heightmapDataRef.current) return null; // terrain not built yet
      return getElevationAt(x, z);
    };
    return () => { delete w.__concordiaSampleGroundY; };
  }, [getElevationAt]);

  // ── Build terrain geometry ────────────────────────────────────

  useEffect(() => {
    let disposed = false;

    async function buildTerrain() {
      const THREE = await import('three');
      if (disposed) return;

      // Determine heightmap resolution based on quality
      const resolutionMap = { low: 128, medium: 256, high: 512, ultra: 1024 };
      const resolution = resolutionMap[quality];
      hmWidthRef.current = resolution;
      hmHeightRef.current = resolution;

      // Use external heightmap or generate procedurally
      let hmData: Float32Array;
      if (externalHeightmap) {
        hmData = externalHeightmap.data;
        hmWidthRef.current = externalHeightmap.width;
        hmHeightRef.current = externalHeightmap.height;
      } else {
        hmData = generatePoughkeepsieHeightmap(resolution, resolution);
      }
      heightmapDataRef.current = hmData;

      // Generate control map for texture splatting
      const controlMap = generateControlMap(
        hmWidthRef.current,
        hmHeightRef.current,
        districts,
        TERRAIN_SIZE,
      );

      // ── Create terrain group ───────────────────────────────────
      const terrainGroup = new THREE.Group();
      terrainGroup.name = 'terrain_chunks';

      // ── Chunked LOD terrain ────────────────────────────────────
      const chunksPerSide = TERRAIN_SIZE / CHUNK_SIZE;
      const zoneList = Object.keys(ZONE_MATERIALS) as TerrainZone[];

      for (let cz = 0; cz < chunksPerSide; cz++) {
        for (let cx = 0; cx < chunksPerSide; cx++) {
          const chunkWorldX = cx * CHUNK_SIZE - TERRAIN_SIZE / 2 + CHUNK_SIZE / 2;
          const chunkWorldZ = cz * CHUNK_SIZE - TERRAIN_SIZE / 2 + CHUNK_SIZE / 2;

          // Determine LOD based on distance to lodCenter
          const dx = chunkWorldX - lodCenter.x;
          const dz = chunkWorldZ - lodCenter.z;
          const dist = Math.sqrt(dx * dx + dz * dz);

          let segments = LOD_LEVELS[LOD_LEVELS.length - 1].segments;
          for (const lod of LOD_LEVELS) {
            if (dist <= lod.distance) {
              segments = lod.segments;
              break;
            }
          }

          // Scale segments by quality
          const qualityScale = { low: 0.25, medium: 0.5, high: 0.75, ultra: 1.0 };
          segments = Math.max(4, Math.round(segments * qualityScale[quality]));

          // Create plane geometry for this chunk
          const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, segments, segments);
          geometry.rotateX(-Math.PI / 2);

          // Displace vertices based on heightmap
          const posAttr = geometry.getAttribute('position');
          const hmW = hmWidthRef.current;
          const hmH = hmHeightRef.current;

          for (let i = 0; i < posAttr.count; i++) {
            const vx = posAttr.getX(i) + chunkWorldX;
            const vz = posAttr.getZ(i) + chunkWorldZ;

            // Sample heightmap
            const nx = (vx + TERRAIN_SIZE / 2) / TERRAIN_SIZE;
            const nz = (vz + TERRAIN_SIZE / 2) / TERRAIN_SIZE;
            const ix = Math.max(0, Math.min(hmW - 1, Math.floor(nx * hmW)));
            const iz = Math.max(0, Math.min(hmH - 1, Math.floor(nz * hmH)));
            const h = hmData[iz * hmW + ix] * 80; // maxElevation = 80

            posAttr.setY(i, h);
          }

          geometry.computeVertexNormals();

          // Determine dominant zone for this chunk from control map
          const cMapX = Math.floor(((chunkWorldX + TERRAIN_SIZE / 2) / TERRAIN_SIZE) * hmW);
          const cMapZ = Math.floor(((chunkWorldZ + TERRAIN_SIZE / 2) / TERRAIN_SIZE) * hmH);
          const cIdx = Math.max(0, Math.min(hmW * hmH - 1, cMapZ * hmW + cMapX));
          const zoneIdx = controlMap[cIdx];
          const zone = zoneList[zoneIdx] || 'wild_grass';
          const matConfig = ZONE_MATERIALS[zone];

          // Create PBR material with zone properties
          const material = new THREE.MeshStandardMaterial({
            color: matConfig.color,
            roughness: matConfig.roughness,
            metalness: matConfig.metalness,
            flatShading: segments < 32,
          });

          // Vertex color splatting + AO baking (valleys dark, hilltops bright — Skyrim style)
          const colors = new Float32Array(posAttr.count * 3);
          const _baseColor = new THREE.Color(matConfig.color);
          const AO_RADIUS = 2;
          const AO_OFFSETS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] as const;
          // Phase O — biome-blend at chunk borders. Zone lookup is a
          // step function over the control map; we run the same
          // 5-sample weighted blend that biome-blend.ts uses so chunk
          // borders smear instead of cliff-edge.
          const getZoneAt = (wx: number, wz: number): BiomeKind => {
            const _nx = (wx + TERRAIN_SIZE / 2) / TERRAIN_SIZE;
            const _nz = (wz + TERRAIN_SIZE / 2) / TERRAIN_SIZE;
            const _ix = Math.max(0, Math.min(hmW - 1, Math.floor(_nx * hmW)));
            const _iz = Math.max(0, Math.min(hmH - 1, Math.floor(_nz * hmH)));
            return (zoneList[controlMap[_iz * hmW + _ix]] ?? 'wild_grass') as unknown as BiomeKind;
          };

          for (let i = 0; i < posAttr.count; i++) {
            const vx = posAttr.getX(i) + chunkWorldX;
            const vz = posAttr.getZ(i) + chunkWorldZ;
            const nx2 = (vx + TERRAIN_SIZE / 2) / TERRAIN_SIZE;
            const nz2 = (vz + TERRAIN_SIZE / 2) / TERRAIN_SIZE;
            const ix2 = Math.max(0, Math.min(hmW - 1, Math.floor(nx2 * hmW)));
            const iz2 = Math.max(0, Math.min(hmH - 1, Math.floor(nz2 * hmH)));
            const vZoneIdx = controlMap[iz2 * hmW + ix2];
            const vZone = zoneList[vZoneIdx] || 'wild_grass';

            // Blend the centre zone's colour with 4 neighbour zones
            // weighted by biome-blend.ts's noise-perturbed kernel.
            const weights = blendedBiomeWeights(vx, vz, TERRAIN_SEED, getZoneAt);
            const vColor = new THREE.Color(0, 0, 0);
            let totalW = 0;
            for (const [zoneName, w] of weights.entries()) {
              const z = (ZONE_MATERIALS as Record<string, { color: number } | undefined>)[zoneName as string];
              if (!z) continue;
              const c = new THREE.Color(z.color);
              vColor.r += c.r * w;
              vColor.g += c.g * w;
              vColor.b += c.b * w;
              totalW += w;
            }
            if (totalW <= 0) {
              vColor.copy(new THREE.Color(ZONE_MATERIALS[vZone].color));
            }

            // AO: vertices lower than their 8 neighbors are concave — darken up to 40%
            const thisH = hmData[iz2 * hmW + ix2];
            let neighborSum = 0;
            for (const [ox, oz] of AO_OFFSETS) {
              const nx3 = Math.max(0, Math.min(hmW - 1, ix2 + ox * AO_RADIUS));
              const nz3 = Math.max(0, Math.min(hmH - 1, iz2 + oz * AO_RADIUS));
              neighborSum += hmData[nz3 * hmW + nx3];
            }
            const avgNeighborH = neighborSum / AO_OFFSETS.length;
            const aoFactor = Math.max(0, Math.min(1, (avgNeighborH - thisH) / 8));
            const aoScale = 1 - aoFactor * 0.4;

            // Polish-pass: procedural per-vertex colour variation. Two noise
            // octaves perturb the base zone colour by ±8% lightness and a
            // small warm/cool drift (±4% hue) so the terrain surface reads
            // as natural variation rather than a single flat sheet.
            const cNoise1 = Math.sin(vx * 0.073 + vz * 0.091) * 0.5;
            const cNoise2 = Math.sin(vx * 0.211 + vz * 0.157) * 0.5;
            const lightness = 1 + (cNoise1 + cNoise2) * 0.08;            // ±0.08
            const warmth    = (cNoise1 - cNoise2) * 0.04;                  // ±0.04 R-vs-B drift

            const r = vColor.r * aoScale * lightness * (1 + warmth);
            const g = vColor.g * aoScale * lightness;
            const b = vColor.b * aoScale * lightness * (1 - warmth);

            colors[i * 3]     = Math.max(0, Math.min(1, r));
            colors[i * 3 + 1] = Math.max(0, Math.min(1, g));
            colors[i * 3 + 2] = Math.max(0, Math.min(1, b));
          }
          geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          material.vertexColors = true;

          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(chunkWorldX, 0, chunkWorldZ);
          mesh.receiveShadow = true;
          mesh.userData = {
            isTerrainChunk: true,
            chunkX: cx,
            chunkZ: cz,
            lodDistance: dist,
            zone,
          };

          terrainGroup.add(mesh);
        }
      }

      // ── Fall Kill Creek channel ───────────────────────────────
      // Carve a lower-elevation channel across the terrain
      // Already handled in heightmap generation, but we add visual markers
      const creekPathPoints: { x: number; z: number }[] = [];
      for (let t = 0; t <= 1; t += 0.02) {
        const nz = t;
        const creekCenterNx = 0.35 + nz * 0.15;
        const worldX = creekCenterNx * TERRAIN_SIZE - TERRAIN_SIZE / 2;
        const worldZ = nz * TERRAIN_SIZE - TERRAIN_SIZE / 2;
        creekPathPoints.push({ x: worldX, z: worldZ });
      }

      // Store creek path in group userData for WaterRenderer
      terrainGroup.userData = {
        creekPath: creekPathPoints,
        getElevationAt,
      };

      // ── Collision mesh ──────────────────────────────────────────
      // Simplified mesh for raycasting (lower resolution)
      const collisionGeom = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 64, 64);
      collisionGeom.rotateX(-Math.PI / 2);
      const collPos = collisionGeom.getAttribute('position');
      for (let i = 0; i < collPos.count; i++) {
        const vx = collPos.getX(i);
        const vz = collPos.getZ(i);
        const h = getElevationAt(vx, vz);
        collPos.setY(i, h);
      }
      collisionGeom.computeVertexNormals();

      const collisionMat = new THREE.MeshBasicMaterial({ visible: false });
      const collisionMesh = new THREE.Mesh(collisionGeom, collisionMat);
      collisionMesh.userData = { isCollisionMesh: true };
      terrainGroup.add(collisionMesh);
      collisionMeshRef.current = collisionMesh;

      terrainGroupRef.current = terrainGroup;

      // Dispatch custom event so parent scene can pick up the terrain group
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('concordia:terrain-ready', {
          detail: {
            terrainGroup,
            getElevationAt,
            // Physics heightfield data
            hmData,
            hmWidth: hmWidthRef.current,
            hmHeight: hmHeightRef.current,
          },
        }));
      }
    }

    buildTerrain();

    return () => {
      disposed = true;
      // Dispose terrain geometries and materials
      if (terrainGroupRef.current) {
        const group = terrainGroupRef.current as {
          traverse: (cb: (obj: unknown) => void) => void;
        };
        group.traverse((obj) => {
          const mesh = obj as {
            geometry?: { dispose: () => void };
            material?: { dispose: () => void } | { dispose: () => void }[];
          };
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => m.dispose());
          }
        });
      }
    };
  }, [externalHeightmap, districts, lodCenter, quality, getElevationAt]);

  // ── Render (invisible container -- terrain lives in Three.js scene) ──

  return (
    <div
      ref={containerRef}
      data-component="terrain-renderer"
      data-quality={quality}
      style={{ display: 'none' }}
      aria-hidden
    />
  );
}

// ── Exported utilities ───────────────────────────────────────────

export { generatePoughkeepsieHeightmap, generateControlMap, ZONE_MATERIALS, TERRAIN_SIZE, CHUNK_SIZE };
