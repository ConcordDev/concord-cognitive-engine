'use client';

/**
 * RockLayer — scatters procedural rocks per biome.
 *
 * Phase A3: wires lib/world-lens/rock-gen.ts into the scene. Per
 * chunk, picks 0–6 rocks (mountain > highland > plains) with
 * deterministic seeds; each rock is rendered as a single
 * MeshStandardMaterial mesh built from rock-gen's BufferGeometry data.
 *
 * Renders only on high/ultra quality (rocks are mid-cost; trees
 * matter more for the BotW silhouette).
 */

import { useEffect, useRef } from 'react';

type RockBiome = 'temperate' | 'desert' | 'alpine' | 'volcanic' | 'coastal' | 'wetland';

interface Props {
  worldId: string;
  biome?: RockBiome;
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  chunkCount?: number;
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export function RockLayer({ worldId, biome = 'temperate', quality = 'high', chunkCount = 16, bounds }: Props) {
  const groupRef = useRef<unknown>(null);

  useEffect(() => {
    if (quality === 'low' || quality === 'medium') return;
    let disposed = false;
    let group: unknown = null;
    let detachScene: (() => void) | null = null;

    (async () => {
      const THREE = await import('three');
      const { generateRock } = await import('@/lib/world-lens/rock-gen');

      const rockGroup = new THREE.Group();
      rockGroup.name = `rock_layer_${worldId}`;
      group = rockGroup;
      groupRef.current = rockGroup;

      const b = bounds ?? { minX: -400, maxX: 400, minZ: -400, maxZ: 400 };
      const rocksPerChunk = biome === 'alpine' ? 6 : biome === 'volcanic' ? 5 : biome === 'desert' ? 4 : 3;

      for (let c = 0; c < chunkCount; c++) {
        const cellSize = Math.sqrt(((b.maxX - b.minX) * (b.maxZ - b.minZ)) / chunkCount);
        const cellsPerRow = Math.max(1, Math.floor((b.maxX - b.minX) / cellSize));
        const row = Math.floor(c / cellsPerRow);
        const col = c % cellsPerRow;
        const cx = b.minX + (col + 0.5) * cellSize;
        const cz = b.minZ + (row + 0.5) * cellSize;

        for (let r = 0; r < rocksPerChunk; r++) {
          if (disposed) return;
          const seed = `${worldId}::${biome}::${c}::${r}`;
          const rock = generateRock({ seed, biome, size: 0.4 + hashU(seed) * 1.4 });
          const geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.BufferAttribute(rock.positions, 3));
          geom.setAttribute('normal',   new THREE.BufferAttribute(rock.normals, 3));
          geom.setAttribute('color',    new THREE.BufferAttribute(rock.colors, 3));
          geom.setIndex(new THREE.BufferAttribute(rock.indices, 1));
          const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.05 });
          const mesh = new THREE.Mesh(geom, mat);
          const u1 = hashU(seed + ':x');
          const u2 = hashU(seed + ':z');
          mesh.position.set(cx + (u1 - 0.5) * cellSize * 0.85, 0, cz + (u2 - 0.5) * cellSize * 0.85);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          rockGroup.add(mesh);
        }
      }

      function onSceneReady(e: Event) {
        const detail = (e as CustomEvent).detail as { scene?: { add: (g: unknown) => void; remove: (g: unknown) => void } } | undefined;
        if (!detail?.scene || disposed) return;
        detail.scene.add(rockGroup);
        detachScene = () => detail.scene?.remove(rockGroup);
      }
      window.addEventListener('concordia:scene-ready', onSceneReady);
      window.dispatchEvent(new CustomEvent('concordia:scene-request-ready'));

      return () => {
        window.removeEventListener('concordia:scene-ready', onSceneReady);
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
