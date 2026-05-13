'use client';

/**
 * TreeLayer — mounts L-system trees per biome onto the scene.
 *
 * Phase A3: wires the orphaned lib/world-lens/l-system-tree.ts into
 * the active renderer. Per chunk (deterministic from chunk seed +
 * world id) picks a tree species via `pickSpeciesForBiome` then
 * generates 4–12 trees via `generateTree`. Trunk + leaves are
 * rendered as cylinder + sphere primitives — light, deterministic,
 * cel-shaded.
 *
 * Quality preset:
 *   high / ultra  →  trees + rocks
 *   medium        →  trees only (this layer)
 *   low           →  nothing (returns null)
 *
 * Listens for the existing `concordia:scene-ready` CustomEvent to
 * resolve a THREE.Scene reference, then attaches its tree group.
 */

import { useEffect, useRef } from 'react';
import { createInstancedMeshPool } from '@/lib/world-lens/instanced-mesh-pool';

type TreeBiomeLocal = 'temperate_forest' | 'boreal' | 'desert' | 'wetland' | 'tropical' | 'alpine' | 'coastal' | 'volcanic';
interface Props {
  worldId: string;
  biome?: TreeBiomeLocal;
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  chunkCount?: number;
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export function TreeLayer({ worldId, biome = 'temperate_forest', quality = 'medium', chunkCount = 16, bounds }: Props) {
  const groupRef = useRef<unknown>(null);

  useEffect(() => {
    if (quality === 'low') return;
    let disposed = false;
    let group: unknown = null;
    let detachScene: (() => void) | null = null;

    (async () => {
      const THREE = await import('three');
      const { pickSpeciesForBiome, generateTree, SPECIES } = await import('@/lib/world-lens/l-system-tree');

      const treeGroup = new THREE.Group();
      treeGroup.name = `tree_layer_${worldId}`;
      group = treeGroup;
      groupRef.current = treeGroup;

      const b = bounds ?? { minX: -400, maxX: 400, minZ: -400, maxZ: 400 };

      // Deterministic per chunk: chunkIdx -> seed
      for (let c = 0; c < chunkCount; c++) {
        const cellSize = Math.sqrt(((b.maxX - b.minX) * (b.maxZ - b.minZ)) / chunkCount);
        const cellsPerRow = Math.max(1, Math.floor((b.maxX - b.minX) / cellSize));
        const row = Math.floor(c / cellsPerRow);
        const col = c % cellsPerRow;
        const cx = b.minX + (col + 0.5) * cellSize;
        const cz = b.minZ + (row + 0.5) * cellSize;
        const seed = `${worldId}::${biome}::${c}`;
        const species = pickSpeciesForBiome(biome, seed);
        // Trees per chunk: 4–12 depending on biome density.
        const treesPerChunk = biome === 'tropical' ? 12 : biome === 'wetland' ? 8 :
                               biome === 'desert' ? 3 : biome === 'alpine' ? 5 : 8;
        for (let t = 0; t < treesPerChunk; t++) {
          if (disposed) return;
          const treeSeed = `${seed}::${t}`;
          const tree = generateTree(species, treeSeed);
          const treeMesh = renderTree(THREE, tree, SPECIES[species]);
          // Place inside the cell with jittered offset.
          const u1 = hashU(treeSeed + ':x');
          const u2 = hashU(treeSeed + ':z');
          treeMesh.position.set(cx + (u1 - 0.5) * cellSize * 0.9, 0, cz + (u2 - 0.5) * cellSize * 0.9);
          treeGroup.add(treeMesh);
        }
      }

      // Attach to scene when ready.
      function onSceneReady(e: Event) {
        const detail = (e as CustomEvent).detail as { scene?: { add: (g: unknown) => void; remove: (g: unknown) => void } } | undefined;
        if (!detail?.scene || disposed) return;
        detail.scene.add(treeGroup);
        detachScene = () => detail.scene?.remove(treeGroup);
      }
      window.addEventListener('concordia:scene-ready', onSceneReady);
      // If scene is already up, request it now via a synthetic event.
      window.dispatchEvent(new CustomEvent('concordia:scene-request-ready'));

      // Phase O — distance-cull trees against camera. ConcordiaScene
      // emits concordia:camera-sync ~10Hz; we toggle visibility on the
      // per-tree groups so trees >600m are dropped from the draw list.
      const { distanceCullMeshes } = await import('@/lib/world-lens/lod');
      const camPos = { x: 0, y: 0, z: 0, distanceTo: (other: unknown) => {
        const o = other as { x: number; y: number; z: number };
        const dx = camPos.x - o.x, dy = camPos.y - o.y, dz = camPos.z - o.z;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
      } };
      function onCamSync(ev: Event) {
        const d = (ev as CustomEvent).detail as { position?: { x: number; y: number; z: number } } | undefined;
        if (!d?.position) return;
        camPos.x = d.position.x; camPos.y = d.position.y; camPos.z = d.position.z;
        const meshes = (treeGroup.children as Array<{ position: { distanceTo: (o: unknown) => number }; visible: boolean }>);
        // distanceCullMeshes expects a position-like camera; we pass an
        // object the per-tree position.distanceTo can consume.
        distanceCullMeshes(meshes, { x: camPos.x, y: camPos.y, z: camPos.z }, 600);
      }
      window.addEventListener('concordia:camera-sync', onCamSync);

      return () => {
        window.removeEventListener('concordia:scene-ready', onSceneReady);
        window.removeEventListener('concordia:camera-sync', onCamSync);
        detachScene?.();
      };
    })();

    return () => {
      disposed = true;
      const g = group as { traverse?: (cb: (m: unknown) => void) => void } | null;
      if (g?.traverse) {
        g.traverse((m) => {
          const mesh = m as { geometry?: { dispose?: () => void }; material?: { dispose?: () => void } };
          mesh.geometry?.dispose?.();
          mesh.material?.dispose?.();
        });
      }
      detachScene?.();
    };
  }, [worldId, biome, quality, chunkCount, bounds]);

  return null;
}

function hashU(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
  }
  return h / 0xffffffff;
}

function renderTree(
  THREE: typeof import('three'),
  tree: { segments: Array<{ start: [number, number, number]; end: [number, number, number]; radiusStart: number; radiusEnd: number }>; leaves: Array<{ position: [number, number, number]; size: number }>; trunkColor: string; leafColor: string; bare: boolean },
  _species: unknown,
): InstanceType<typeof import('three').Group> {
  const tg = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(tree.trunkColor), roughness: 0.95 });
  for (const seg of tree.segments) {
    const dx = seg.end[0] - seg.start[0];
    const dy = seg.end[1] - seg.start[1];
    const dz = seg.end[2] - seg.start[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 0.01) continue;
    const radius = (seg.radiusStart + seg.radiusEnd) / 2;
    const geom = new THREE.CylinderGeometry(seg.radiusEnd, seg.radiusStart, length, 6, 1, false);
    void radius;
    const mesh = new THREE.Mesh(geom, trunkMat);
    mesh.position.set((seg.start[0] + seg.end[0]) / 2, (seg.start[1] + seg.end[1]) / 2, (seg.start[2] + seg.end[2]) / 2);
    // Orient
    mesh.lookAt(new THREE.Vector3(seg.end[0], seg.end[1], seg.end[2]));
    mesh.rotateX(Math.PI / 2);
    mesh.castShadow = true;
    tg.add(mesh);
  }
  if (!tree.bare && tree.leaves.length > 0) {
    // Phase O — one InstancedMesh per tree's leaves via the shared
    // instanced-mesh-pool (one draw call). Pool capacity matches leaf
    // count exactly; per-leaf scale captures the leaf.size variation.
    const leafMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(tree.leafColor), roughness: 0.85 });
    const unitLeaf = new THREE.SphereGeometry(1, 5, 4);
    const pool = createInstancedMeshPool(THREE, tg, unitLeaf, leafMat, tree.leaves.length);
    for (const leaf of tree.leaves) {
      pool.add({
        position: { x: leaf.position[0], y: leaf.position[1], z: leaf.position[2] },
        scale: leaf.size,
      });
    }
  }
  return tg;
}
