import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createArmorPiece, createArmorSet, type ArmorAppearance } from '@/lib/concordia/armor-system';
import { clearProceduralCache } from '@/lib/world-lens/procedural-texture';

// 2026-07-21 — armor-system.ts previously built flat solid-color
// MeshStandardMaterials with no texture detail at all. Wired to
// procedural-texture.ts's makePBR() (real-reference-grounded per
// material-reference-palettes.ts) for normalMap/roughnessMap surface
// detail, while keeping `.color` as the real per-faction dye — so
// customization is preserved and armor gains genuine material detail
// (brushed-metal streaks, leather crinkle, cloth weave) grounded in the
// same real reference data as terrain/procedural-texture.ts's other kinds.
describe('armor-system procedural material detail', () => {
  const base: ArmorAppearance = {
    silhouette: 'heavy_plate',
    primaryColor: '#3a4a5c',
    secondaryColor: '#222833',
    accentColor: '#c8a838',
    tier: 3,
    seed: 'test-seed-1',
  };

  it('every material slot carries a normalMap and roughnessMap (not flat color-only)', () => {
    clearProceduralCache();
    const piece = createArmorPiece('torso', base);
    let materialCount = 0;
    piece.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as THREE.Mesh).isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.normalMap, 'material should have real-reference normal detail').toBeTruthy();
      expect(mat.roughnessMap, 'material should have real-reference roughness detail').toBeTruthy();
      materialCount++;
    });
    expect(materialCount).toBeGreaterThan(0);
  });

  it('the real per-faction dye color is preserved — .color is untouched by the texture', () => {
    clearProceduralCache();
    const piece = createArmorPiece('head', base);
    const firstMesh = piece.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
    const mat = firstMesh.material as THREE.MeshStandardMaterial;
    expect(mat.map, 'albedo map must NOT be set — texture is detail-only, color stays the real dye').toBeFalsy();
    // primaryColor darkened by wear=0 should equal primaryColor exactly
    expect(mat.color.getHexString()).toBe(new THREE.Color(base.primaryColor).getHexString());
  });

  it('heavy_plate -> metal, robed -> cloth, leather/exposed -> leather detail kind', () => {
    clearProceduralCache();
    const plate = createArmorPiece('torso', { ...base, silhouette: 'heavy_plate', seed: 'k1' });
    const robed = createArmorPiece('torso', { ...base, silhouette: 'robed', seed: 'k1' });
    const leather = createArmorPiece('torso', { ...base, silhouette: 'leather', seed: 'k1' });
    const exposed = createArmorPiece('torso', { ...base, silhouette: 'exposed', seed: 'k1' });

    const normalMapOf = (g: THREE.Group) => {
      const m = g.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
      return (m.material as THREE.MeshStandardMaterial).normalMap;
    };

    // Same seed, different silhouette -> different procedural kind -> different texture
    expect(normalMapOf(plate)).not.toBe(normalMapOf(robed));
    expect(normalMapOf(plate)).not.toBe(normalMapOf(leather));
    // leather and exposed share the 'leather' kind + same seed -> identical cached texture
    expect(normalMapOf(leather)).toBe(normalMapOf(exposed));
  });

  it('all 4 slots of one armor set share the same seed -> the same cached texture (visually consistent suit)', () => {
    clearProceduralCache();
    const set = createArmorSet(base);
    const normalMaps = new Set<THREE.Texture>();
    for (const group of set.values()) {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!(mesh as THREE.Mesh).isMesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.normalMap) normalMaps.add(mat.normalMap);
      });
    }
    expect(normalMaps.size).toBe(1);
  });

  it('a different seed produces a different (non-cached) texture for the same silhouette', () => {
    clearProceduralCache();
    const a = createArmorPiece('torso', { ...base, seed: 'seed-a' });
    const b = createArmorPiece('torso', { ...base, seed: 'seed-b' });
    const matA = (a.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const matB = (b.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(matA.normalMap).not.toBe(matB.normalMap);
  });

  it('never throws across every silhouette', () => {
    clearProceduralCache();
    const silhouettes: ArmorAppearance['silhouette'][] = ['heavy_plate', 'robed', 'leather', 'exposed'];
    for (const silhouette of silhouettes) {
      expect(() => createArmorSet({ ...base, silhouette })).not.toThrow();
    }
  });
});
