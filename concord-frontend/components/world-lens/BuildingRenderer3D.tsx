'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { TextureForge } from '@/lib/world-lens/texture-forge';
import { makeStandardLOD } from '@/lib/world-lens/lod';

// ── Types ──────────────────────────────────────────────────────────

export type BuildingMaterialType =
  | 'usb'       // Universal Standard Brick: smooth matte
  | 'brick'     // Red brick with mortar
  | 'stone'     // Rough gray stone
  | 'wood'      // Warm wood grain
  | 'steel'     // Metallic steel
  | 'concrete'  // Gray rough concrete
  | 'glass';    // Transparent / fresnel

export type ViewMode = 'normal' | 'stress_heatmap' | 'validation';

export interface BuildingDTU {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  dimensions: { width: number; height: number; depth: number };
  floors: number;
  material: BuildingMaterialType;
  style: 'colonial' | 'federal' | 'industrial' | 'modern' | 'mixed';
  /** World/seed/station building type — drives the procedural archetype + iconic
   *  silhouette feature (lib/world-lens/building-silhouette.ts). Absent for
   *  player-designed structural DTUs, which keep the legacy structural render. */
  building_type?: string;
  /** Structural elements specification */
  structure: {
    columns: { count: number; spacing: number; radius: number };
    beams: { count: number; height: number };
    roofType: 'flat' | 'gable' | 'hip' | 'mansard' | 'gambrel';
    roofPitch?: number; // degrees
    hasBasement: boolean;
    windowRows: number;
    windowsPerRow: number;
  };
  /** Optional interior definition */
  interior?: {
    rooms: { name: string; floor: number; width: number; depth: number }[];
  };
}

export interface ValidationData {
  buildingId: string;
  /** Stress ratio: 0 = no load, 1.0 = at capacity, >1.0 = overstressed */
  stressRatio: number;
  /** Per-element stress for heatmap */
  elementStress?: {
    elementId: string;
    type: 'column' | 'beam' | 'wall' | 'foundation';
    stress: number;
  }[];
  /** Whether this building has a structural failure */
  hasFailure: boolean;
  failureType?: 'buckling' | 'bowing' | 'separation' | 'collapse';
}

interface BuildingRenderer3DProps {
  buildings: BuildingDTU[];
  materials?: Record<string, BuildingMaterialType>;
  validationData?: ValidationData[];
  viewMode: ViewMode;
  renderStyle?: 'pbr' | 'toon';
  toonGradient?: [string, string, string];
  onBuildingClick?: (buildingId: string) => void;
  /** T3.3 — per-world building silhouette spec (from buildingStyleForWorld).
   * Overrides material emissive/roughness/metalness so each world reads
   * distinct. Unset → warm default glow (back-compat). */
  buildingStyle?: import('@/lib/world-lens/concordia-theme').BuildingStyleSpec;
}

// ── Material Configuration ──────────────────────────────────────

const PBR_MATERIAL_CONFIG: Record<BuildingMaterialType, {
  color: number;
  roughness: number;
  metalness: number;
  transparent: boolean;
  opacity: number;
}> = {
  usb:      { color: 0xd4c5a9, roughness: 0.6,  metalness: 0.0,  transparent: false, opacity: 1.0 },
  brick:    { color: 0x8b3a2a, roughness: 0.75, metalness: 0.0,  transparent: false, opacity: 1.0 },
  stone:    { color: 0x7a7a7a, roughness: 0.85, metalness: 0.0,  transparent: false, opacity: 1.0 },
  wood:     { color: 0xa0724a, roughness: 0.7,  metalness: 0.0,  transparent: false, opacity: 1.0 },
  steel:    { color: 0xb0b0b8, roughness: 0.3,  metalness: 0.85, transparent: false, opacity: 1.0 },
  concrete: { color: 0x999999, roughness: 0.9,  metalness: 0.0,  transparent: false, opacity: 1.0 },
  glass:    { color: 0xaaddff, roughness: 0.1,  metalness: 0.2,  transparent: true,  opacity: 0.35 },
};

// ── Stress Color Mapping ────────────────────────────────────────

function stressToColor(stress: number): number {
  // blue(0) -> green(0.25) -> yellow(0.5) -> orange(0.75) -> red(1.0+)
  if (stress <= 0.25) {
    // Blue to green
    const t = stress / 0.25;
    const r = 0;
    const g = Math.floor(t * 255);
    const b = Math.floor((1 - t) * 255);
    return (r << 16) | (g << 8) | b;
  } else if (stress <= 0.5) {
    const t = (stress - 0.25) / 0.25;
    const r = Math.floor(t * 255);
    const g = 255;
    const b = 0;
    return (r << 16) | (g << 8) | b;
  } else if (stress <= 0.75) {
    const t = (stress - 0.5) / 0.25;
    const r = 255;
    const g = Math.floor((1 - t * 0.5) * 255);
    const b = 0;
    return (r << 16) | (g << 8) | b;
  } else {
    const t = Math.min(1, (stress - 0.75) / 0.25);
    const r = 255;
    const g = Math.floor((1 - t) * 128);
    const b = 0;
    return (r << 16) | (g << 8) | b;
  }
}

function validationEmissiveColor(stressRatio: number): { color: number; intensity: number; pulse: boolean } {
  if (stressRatio <= 0.5) return { color: 0x000000, intensity: 0, pulse: false };
  if (stressRatio <= 0.7) return { color: 0x00ff00, intensity: 0.3, pulse: false };
  if (stressRatio <= 0.9) return { color: 0xffff00, intensity: 0.5, pulse: false };
  if (stressRatio <= 1.0) return { color: 0xff8800, intensity: 0.7, pulse: false };
  return { color: 0xff0000, intensity: 1.0, pulse: true };
}

// ── Component ────────────────────────────────────────────────────

export default function BuildingRenderer3D({
  buildings,
  validationData,
  viewMode,
  renderStyle = 'pbr',
  toonGradient = ['#1a1a2e', '#3a3a5a', '#8888bb'],
  onBuildingClick,
  buildingStyle,
}: BuildingRenderer3DProps) {
  const buildingGroupRef = useRef<unknown>(null);
  const instancedMeshesRef = useRef<Map<string, unknown>>(new Map());

  // ── Render a single building from DTU ─────────────────────────

  const renderFromDTU = useCallback(async (
    dtu: BuildingDTU,
    THREE: typeof import('three'),
    validation?: ValidationData,
  ) => {
    // Phase A2: if the DTU has a recognised archetype (tavern / archive /
    // forge / market / tower) AND faction visual heraldry, take the
    // procedural-buildings path which builds richer silhouettes per
    // architecture style (fortified / gracile / crystalline / organic /
    // industrial). Falls through to the legacy box-composite path when
    // archetype isn't in the procgen registry.
    const knownArchetypes = ['tavern', 'archive', 'forge', 'market', 'tower'] as const;
    type ProcArch = typeof knownArchetypes[number];
    const explicitArch = (dtu as { archetype?: string }).archetype;
    const buildingType = (dtu as { building_type?: string }).building_type;
    // Take the rich procedural path for any building with an explicit archetype
    // OR a building_type (seed / lens-station buildings) — the latter derives its
    // archetype + iconic landmark feature (dome / spire / colonnade / belfry) from
    // the type. Player-designed DTUs with neither keep the structural legacy path.
    const hasExplicit = !!explicitArch && (knownArchetypes as readonly string[]).includes(explicitArch);
    if (hasExplicit || buildingType) {
      try {
        const { createBuilding } = await import('@/lib/world-lens/procedural-buildings');
        const { silhouetteForBuildingType } = await import('@/lib/world-lens/building-silhouette');
        const sil = silhouetteForBuildingType(buildingType);
        const dtuArch: ProcArch = hasExplicit ? (explicitArch as ProcArch) : sil.archetype;
        const feature = (dtu as { feature?: import('@/lib/world-lens/procedural-buildings').IconicFeature }).feature ?? sil.feature;
        const factionVisual = (dtu as { faction_visual?: { primary_color?: string; secondary_color?: string; accent_color?: string } }).faction_visual;
        const archStyleByArch: Record<ProcArch, 'fortified' | 'gracile' | 'crystalline' | 'organic' | 'industrial'> = {
          tavern: 'organic', archive: 'gracile', forge: 'fortified',
          market: 'gracile', tower: 'fortified',
        };
        // WAVE WD — World Density: attach a lazy interior so the building's
        // door can open (the decor stays invisible until setInteriorVisible is
        // called by the in-scene reveal trigger). Flag-gated; off == today.
        const { getClientConfigSync } = await import('@/hooks/useClientConfig');
        const worldDensityOn = getClientConfigSync().flags.worldDensity;
        const result = createBuilding(THREE, {
          archetype: dtuArch,
          feature,
          seed: dtu.id,
          withInterior: worldDensityOn ? 'lazy' : false,
          factionStyle: factionVisual ? {
            primary_color: factionVisual.primary_color,
            secondary_color: factionVisual.secondary_color,
            accent_color: factionVisual.accent_color,
            architecture_style: archStyleByArch[dtuArch],
          } : { architecture_style: archStyleByArch[dtuArch] },
        });
        result.name = `building_${dtu.id}`;
        // Merge (not overwrite) so createBuilding's archetype + _interiorMode
        // survive — setInteriorVisible() reads them to lazy-attach the decor.
        result.userData = { ...result.userData, buildingId: dtu.id, dtuName: dtu.name };
        result.scale.set(dtu.dimensions.width / 10, dtu.dimensions.height / 8, dtu.dimensions.depth / 8);
        return result;
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[BuildingRenderer3D] procedural-buildings failed, falling back to legacy', err);
      }
    }
    const group = new THREE.Group();
    group.name = `building_${dtu.id}`;
    group.userData = { buildingId: dtu.id, dtuName: dtu.name };

    const { width, height, depth } = dtu.dimensions;
    const matType = dtu.material;
    const matConfig = PBR_MATERIAL_CONFIG[matType];

    // normalScale per material type — brick joints deep, glass barely perceptible
    const NORMAL_SCALE: Record<BuildingMaterialType, [number, number]> = {
      brick:    [1.0, 1.0],
      stone:    [0.8, 0.8],
      concrete: [0.8, 0.8],
      usb:      [0.6, 0.6],
      wood:     [0.5, 0.5],
      steel:    [0.4, 0.4],
      glass:    [0.2, 0.2],
    };

    const getProceduralTextures = (type: BuildingMaterialType) => {
      try {
        let pair;
        if (type === 'brick')         pair = TextureForge.getBrick('red');
        else if (type === 'stone')    pair = TextureForge.getConcrete(0.3);
        else if (type === 'concrete') pair = TextureForge.getConcrete(0.6);
        else if (type === 'usb')      pair = TextureForge.getConcrete(0.15);
        else if (type === 'wood')     pair = TextureForge.getWood('oak');
        else if (type === 'steel')    pair = TextureForge.getMetal('brushed');
        else if (type === 'glass')    pair = TextureForge.getGlass('#aaddff');
        if (!pair) return {};
        const [ns0, ns1] = NORMAL_SCALE[type];
        return {
          map: new THREE.CanvasTexture(pair.map),
          roughnessMap: new THREE.CanvasTexture(pair.roughnessMap),
          normalMap: new THREE.CanvasTexture(pair.normalMap),
          normalScale: new THREE.Vector2(ns0, ns1),
        };
      } catch {
        return {};
      }
    };

    // Toon gradient map: 1×3 DataTexture with NearestFilter (required by MeshToonMaterial)
    const createToonGradientMap = () => {
      const data = new Uint8Array(3 * 4);
      const stops = toonGradient.map(hex => {
        const n = parseInt(hex.replace('#', ''), 16);
        return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
      });
      for (let i = 0; i < 3; i++) {
        data[i * 4]     = stops[i][0];
        data[i * 4 + 1] = stops[i][1];
        data[i * 4 + 2] = stops[i][2];
        data[i * 4 + 3] = 255;
      }
      const tex = new THREE.DataTexture(data, 1, 3);
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      return tex;
    };

    const createMaterial = (overrides?: Partial<typeof matConfig>) => {
      const cfg = { ...matConfig, ...overrides };

      if (renderStyle === 'toon' && !overrides) {
        return new THREE.MeshToonMaterial({
          color: cfg.color,
          transparent: cfg.transparent,
          opacity: cfg.opacity,
          emissive: new THREE.Color(0xffcc88),
          emissiveIntensity: 0.05,
          gradientMap: createToonGradientMap(),
        });
      }

      const textures = overrides ? {} : getProceduralTextures(matType);
      // T3.3 — per-world silhouette: when a buildingStyle spec is supplied, its
      // emissive / roughness / metalness override the defaults so cyber reads
      // neon-emissive and crime reads matte-noir. Falls back to the warm
      // default glow when no style is active (back-compat).
      const styleEmissive = buildingStyle && buildingStyle.emissive
        ? new THREE.Color(buildingStyle.emissive) : new THREE.Color(0xffcc88);
      const styleEmissiveIntensity = buildingStyle ? buildingStyle.emissiveIntensity : 0.08;
      return new THREE.MeshStandardMaterial({
        color: cfg.color,
        roughness: buildingStyle ? buildingStyle.roughness : cfg.roughness,
        metalness: buildingStyle ? buildingStyle.metalness : cfg.metalness,
        transparent: cfg.transparent,
        opacity: cfg.opacity,
        emissive: styleEmissive,
        emissiveIntensity: styleEmissiveIntensity,
        ...textures,
      });
    };

    // ── Foundation ──────────────────────────────────────────────
    const foundationHeight = dtu.structure.hasBasement ? 3 : 0.5;
    const foundationGeom = new THREE.BoxGeometry(width + 0.4, foundationHeight, depth + 0.4);
    const foundationMat = createMaterial({ color: 0x555555, roughness: 0.9 });
    const foundation = new THREE.Mesh(foundationGeom, foundationMat);
    foundation.position.y = foundationHeight / 2;
    foundation.castShadow = true;
    foundation.receiveShadow = true;
    foundation.userData = { elementType: 'foundation' };
    group.add(foundation);

    // ── Walls (one box per floor for LOD-friendliness) ──────────
    // EvoAsset hook: resolve the canonical texture for this DTU. When the
    // server has promoted a higher-quality version through the Atlas
    // pipeline, the resolved URL points to that version's diffuse map;
    // otherwise resolveAssetUrl returns null and the wall keeps its
    // procedural texture pair.
    let evoTexture: import('three').Texture | null = null;
    try {
      const m = await import('@/lib/evo-asset/loader');
      const url = await m.resolveAssetUrl({ source: 'authored', sourceId: dtu.id });
      if (url) {
        evoTexture = await new Promise<import('three').Texture | null>((resolve) => {
          const loader = new THREE.TextureLoader();
          loader.load(url, (tex) => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            resolve(tex);
          }, undefined, () => resolve(null));
        });
      }
    } catch { /* fall through to procedural */ }

    const floorHeight = height / dtu.floors;
    for (let f = 0; f < dtu.floors; f++) {
      const wallGeom = new THREE.BoxGeometry(width, floorHeight, depth);
      const wallMat = createMaterial();
      if (evoTexture && 'map' in wallMat) {
        (wallMat as InstanceType<typeof THREE.MeshStandardMaterial>).map = evoTexture;
        (wallMat as InstanceType<typeof THREE.MeshStandardMaterial>).needsUpdate = true;
      }
      const wall = new THREE.Mesh(wallGeom, wallMat);
      wall.position.y = foundationHeight + f * floorHeight + floorHeight / 2;
      wall.castShadow = true;
      wall.receiveShadow = true;
      wall.userData = { elementType: 'wall', floor: f, evoTextureApplied: !!evoTexture };
      group.add(wall);
    }

    // ── Columns ──────────────────────────────────────────────────
    const { columns } = dtu.structure;
    if (columns.count > 0) {
      const colGeom = new THREE.CylinderGeometry(
        columns.radius, columns.radius, height, 8,
      );

      // Use instanced mesh for repeated columns
      const colMat = createMaterial({
        color: matType === 'steel' ? 0xa0a0a8 : 0x888888,
        metalness: matType === 'steel' ? 0.9 : 0.1,
      });
      const instancedColumns = new THREE.InstancedMesh(colGeom, colMat, columns.count);
      instancedColumns.castShadow = true;

      const dummy = new THREE.Object3D();
      for (let c = 0; c < columns.count; c++) {
        const angle = (c / columns.count) * Math.PI * 2;
        const cx = Math.cos(angle) * (width / 2 - columns.radius);
        const cz = Math.sin(angle) * (depth / 2 - columns.radius);
        dummy.position.set(cx, foundationHeight + height / 2, cz);
        dummy.updateMatrix();
        instancedColumns.setMatrixAt(c, dummy.matrix);
      }
      instancedColumns.instanceMatrix.needsUpdate = true;
      instancedColumns.userData = { elementType: 'columns' };
      group.add(instancedColumns);
      instancedMeshesRef.current.set(`${dtu.id}_columns`, instancedColumns);
    }

    // ── Beams (horizontal structural members per floor) ──────────
    const { beams } = dtu.structure;
    if (beams.count > 0) {
      const beamGeom = new THREE.BoxGeometry(width, beams.height, 0.3);
      const beamMat = createMaterial({
        color: matType === 'steel' ? 0xa0a0a8 : 0x7a6040,
        metalness: matType === 'steel' ? 0.85 : 0.0,
      });
      const instancedBeams = new THREE.InstancedMesh(beamGeom, beamMat, beams.count);

      const dummy = new THREE.Object3D();
      for (let b = 0; b < beams.count; b++) {
        const floor = Math.floor(b / Math.max(1, beams.count / dtu.floors));
        const beamZ = (b % 3 - 1) * (depth / 3);
        dummy.position.set(0, foundationHeight + (floor + 1) * floorHeight, beamZ);
        dummy.updateMatrix();
        instancedBeams.setMatrixAt(b, dummy.matrix);
      }
      instancedBeams.instanceMatrix.needsUpdate = true;
      instancedBeams.userData = { elementType: 'beams' };
      group.add(instancedBeams);
      instancedMeshesRef.current.set(`${dtu.id}_beams`, instancedBeams);
    }

    // ── Windows (instanced quads) ────────────────────────────────
    const { windowRows, windowsPerRow } = dtu.structure;
    const windowCount = windowRows * windowsPerRow * 2; // front + back
    if (windowCount > 0) {
      const winGeom = new THREE.PlaneGeometry(1.2, 1.5);
      const winMat = new THREE.MeshStandardMaterial({
        color: 0xaaddff,
        roughness: 0.1,
        metalness: 0.2,
        transparent: true,
        opacity: 0.4,
      });
      const instancedWindows = new THREE.InstancedMesh(winGeom, winMat, windowCount);

      const dummy = new THREE.Object3D();
      let wIdx = 0;
      for (let row = 0; row < windowRows; row++) {
        for (let col = 0; col < windowsPerRow; col++) {
          const wx = (col / (windowsPerRow - 1 || 1) - 0.5) * (width - 2);
          const wy = foundationHeight + (row + 0.5) * floorHeight;

          // Front face
          dummy.position.set(wx, wy, depth / 2 + 0.01);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          instancedWindows.setMatrixAt(wIdx++, dummy.matrix);

          // Back face
          dummy.position.set(wx, wy, -depth / 2 - 0.01);
          dummy.rotation.set(0, Math.PI, 0);
          dummy.updateMatrix();
          instancedWindows.setMatrixAt(wIdx++, dummy.matrix);
        }
      }
      instancedWindows.instanceMatrix.needsUpdate = true;
      instancedWindows.userData = { elementType: 'windows' };
      group.add(instancedWindows);
      instancedMeshesRef.current.set(`${dtu.id}_windows`, instancedWindows);
    }

    // ── Roof ─────────────────────────────────────────────────────
    const roofY = foundationHeight + height;
    const { roofType, roofPitch = 30 } = dtu.structure;
    const roofMat = createMaterial({ color: 0x6a4a3a, roughness: 0.8 });

    switch (roofType) {
      case 'gable': {
        const roofHeight = Math.tan((roofPitch * Math.PI) / 180) * (width / 2);
        const roofShape = new THREE.Shape();
        roofShape.moveTo(-width / 2, 0);
        roofShape.lineTo(0, roofHeight);
        roofShape.lineTo(width / 2, 0);
        roofShape.closePath();

        const extrudeSettings = { depth: depth, bevelEnabled: false };
        const roofGeom = new THREE.ExtrudeGeometry(roofShape, extrudeSettings);
        const roof = new THREE.Mesh(roofGeom, roofMat);
        roof.position.set(0, roofY, -depth / 2);
        roof.castShadow = true;
        roof.userData = { elementType: 'roof' };
        group.add(roof);
        break;
      }
      case 'hip': {
        const roofHeight = Math.tan((roofPitch * Math.PI) / 180) * Math.min(width, depth) / 2;
        const roofGeom = new THREE.ConeGeometry(
          Math.sqrt(width * width + depth * depth) / 2,
          roofHeight,
          4,
        );
        const roof = new THREE.Mesh(roofGeom, roofMat);
        roof.position.y = roofY + roofHeight / 2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        roof.userData = { elementType: 'roof' };
        group.add(roof);
        break;
      }
      case 'mansard': {
        // Two-slope roof: steep lower, shallow upper
        const lowerH = 2;
        const upperH = 1;
        const inset = 1;
        // Lower steep section
        const lowerGeom = new THREE.BoxGeometry(width - inset, lowerH, depth - inset);
        const lower = new THREE.Mesh(lowerGeom, roofMat);
        lower.position.y = roofY + lowerH / 2;
        lower.castShadow = true;
        group.add(lower);
        // Upper shallow section
        const upperGeom = new THREE.BoxGeometry(width - inset * 3, upperH, depth - inset * 3);
        const upper = new THREE.Mesh(upperGeom, roofMat);
        upper.position.y = roofY + lowerH + upperH / 2;
        upper.castShadow = true;
        upper.userData = { elementType: 'roof' };
        group.add(upper);
        break;
      }
      case 'gambrel': {
        // Barn-style: two slopes per side
        const roofHeight = 3;
        const roofGeom = new THREE.BoxGeometry(width + 0.5, roofHeight, depth + 0.5);
        const roof = new THREE.Mesh(roofGeom, roofMat);
        roof.position.y = roofY + roofHeight / 2;
        roof.castShadow = true;
        roof.userData = { elementType: 'roof' };
        group.add(roof);
        break;
      }
      case 'flat':
      default: {
        const roofGeom = new THREE.BoxGeometry(width + 0.3, 0.3, depth + 0.3);
        const roof = new THREE.Mesh(roofGeom, roofMat);
        roof.position.y = roofY + 0.15;
        roof.castShadow = true;
        roof.receiveShadow = true;
        roof.userData = { elementType: 'roof' };
        group.add(roof);
        break;
      }
    }

    // ── Validation overlay (emissive glow based on stress) ──────
    if (viewMode === 'validation' && validation) {
      const glow = validationEmissiveColor(validation.stressRatio);
      group.traverse((child) => {
        const mesh = child as unknown as {
          material?: InstanceType<typeof import('three').MeshStandardMaterial>;
          isMesh?: boolean;
        };
        if (mesh.isMesh && mesh.material) {
          mesh.material.emissive = new THREE.Color(glow.color);
          mesh.material.emissiveIntensity = glow.intensity;
        }
      });

      // Pulsing animation for critical stress
      if (glow.pulse) {
        group.userData.update = (_delta: number, elapsed: number) => {
          const pulseIntensity = 0.5 + Math.sin(elapsed * 4) * 0.5;
          group.traverse((child) => {
            const mesh = child as unknown as {
              material?: InstanceType<typeof import('three').MeshStandardMaterial>;
              isMesh?: boolean;
            };
            if (mesh.isMesh && mesh.material) {
              mesh.material.emissiveIntensity = pulseIntensity;
            }
          });
        };
      }
    }

    // ── Stress heatmap mode ─────────────────────────────────────
    if (viewMode === 'stress_heatmap' && validation) {
      group.traverse((child) => {
        const mesh = child as unknown as {
          material?: InstanceType<typeof import('three').MeshStandardMaterial>;
          isMesh?: boolean;
          userData?: { elementType?: string };
        };
        if (mesh.isMesh && mesh.material && mesh.userData?.elementType) {
          // Find per-element stress or use overall
          const elementStress = validation.elementStress?.find(
            (e) => e.type === mesh.userData!.elementType,
          );
          const stress = elementStress?.stress ?? validation.stressRatio;
          mesh.material.color = new THREE.Color(stressToColor(stress));
          mesh.material.emissive = new THREE.Color(stressToColor(stress));
          mesh.material.emissiveIntensity = 0.3;
          mesh.material.roughness = 1.0;
          mesh.material.metalness = 0.0;
        }
      });
    }

    // ── Failure deformation animation ───────────────────────────
    if (validation?.hasFailure && validation.failureType) {
      group.userData.update = (_delta: number, elapsed: number) => {
        const t = Math.min(1, elapsed * 0.1); // Slow deformation over time

        group.traverse((child) => {
          const mesh = child as unknown as {
            userData?: { elementType?: string };
            position?: { y: number; x: number };
            scale?: { set: (x: number, y: number, z: number) => void };
            rotation?: { z: number };
          };
          if (!mesh.userData?.elementType) return;

          switch (validation.failureType) {
            case 'bowing':
              if (mesh.userData.elementType === 'beams') {
                const bowAmount = Math.sin(t * Math.PI) * 0.3;
                if (mesh.scale) mesh.scale.set(1, 1 - bowAmount, 1);
              }
              break;
            case 'buckling':
              if (mesh.userData.elementType === 'columns') {
                if (mesh.rotation) mesh.rotation.z = Math.sin(elapsed * 2) * t * 0.1;
              }
              break;
            case 'separation':
              if (mesh.userData.elementType === 'wall') {
                if (mesh.position) mesh.position.x += Math.sin(elapsed) * t * 0.02;
              }
              break;
            case 'collapse':
              if (mesh.position) {
                mesh.position.y -= t * 0.5;
              }
              if (mesh.rotation) {
                mesh.rotation.z += t * 0.02;
              }
              break;
          }
        });
      };
    }

    // ── Position in world ────────────────────────────────────────
    group.position.set(dtu.position.x, dtu.position.y, dtu.position.z);

    return group;
  }, [viewMode, renderStyle, toonGradient, buildingStyle]);

  // ── Build all buildings ────────────────────────────────────────

  useEffect(() => {
    let disposed = false;

    // EvoAsset: passive presence interaction. Each building rendered into
    // the scene gets a low-weight (0.1) interaction signal so the registry
    // accumulates a baseline of which buildings exist + are visible. Active
    // engagements (click, combat near, NPC interaction) layer on top with
    // higher weights elsewhere.
    void (async () => {
      try {
        const m = await import('@/lib/evo-asset/loader');
        for (const b of (buildings || [])) {
          if (b?.id) m.recordAssetInteraction('authored', b.id, 'render', 0.1);
        }
      } catch { /* best-effort */ }
    })();

    async function buildAllBuildings() {
      const THREE = await import('three');
      if (disposed) return;

      const parentGroup = new THREE.Group();
      parentGroup.name = 'building_renderer';

      const validationMap = new Map<string, ValidationData>();
      if (validationData) {
        for (const v of validationData) {
          validationMap.set(v.buildingId, v);
        }
      }

      // Render each building from DTU
      for (const dtu of buildings) {
        const validation = validationMap.get(dtu.id);
        const buildingGroup = await renderFromDTU(dtu, THREE, validation);
        if (disposed) return;

        // Phase O — LOD via the standard-LOD helper.
        const simplifiedGeom = new THREE.BoxGeometry(
          dtu.dimensions.width,
          dtu.dimensions.height,
          dtu.dimensions.depth,
        );
        const simplifiedMat = new THREE.MeshStandardMaterial({
          color: PBR_MATERIAL_CONFIG[dtu.material].color,
          roughness: 0.8,
        });
        const simplified = new THREE.Mesh(simplifiedGeom, simplifiedMat);
        simplified.position.y = dtu.dimensions.height / 2;
        simplified.castShadow = true;
        const simplifiedGroup = new THREE.Group();
        simplifiedGroup.add(simplified);

        const proxyGeom = new THREE.BoxGeometry(
          dtu.dimensions.width,
          dtu.dimensions.height,
          dtu.dimensions.depth,
        );
        const proxyMat = new THREE.MeshLambertMaterial({
          color: PBR_MATERIAL_CONFIG[dtu.material].color,
        });
        const proxy = new THREE.Mesh(proxyGeom, proxyMat);
        proxy.position.y = dtu.dimensions.height / 2;
        const proxyGroup = new THREE.Group();
        proxyGroup.add(proxy);

        const billboardGeom = new THREE.PlaneGeometry(
          dtu.dimensions.width,
          dtu.dimensions.height,
        );
        const billboardMat = new THREE.MeshBasicMaterial({
          color: PBR_MATERIAL_CONFIG[dtu.material].color,
          transparent: true,
          opacity: 0.6,
        });
        const billboard = new THREE.Mesh(billboardGeom, billboardMat);
        billboard.position.y = dtu.dimensions.height / 2;
        const billboardGroup = new THREE.Group();
        billboardGroup.add(billboard);

        const lod = makeStandardLOD(THREE, {
          high: buildingGroup,
          medium: simplifiedGroup,
          low: proxyGroup,
          billboard: billboardGroup,
        });

        lod.position.set(dtu.position.x, dtu.position.y, dtu.position.z);
        lod.userData = { buildingId: dtu.id, buildingName: dtu.name };

        parentGroup.add(lod);
      }

      // ── Shadow casting optimization: only within 100m ────────
      parentGroup.userData.update = (_delta: number, _elapsed: number) => {
        // Could implement distance-based shadow toggle here
        // using camera position from scene context
      };

      buildingGroupRef.current = parentGroup;

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('concordia:buildings-ready', {
          detail: { buildingGroup: parentGroup, onBuildingClick },
        }));
      }
    }

    buildAllBuildings();

    const instancedMeshes = instancedMeshesRef.current;
    return () => {
      disposed = true;
      instancedMeshes.clear();
      if (buildingGroupRef.current) {
        const group = buildingGroupRef.current as {
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
  }, [buildings, validationData, viewMode, renderFromDTU, onBuildingClick]);

  return (
    <div
      data-component="building-renderer-3d"
      data-building-count={buildings.length}
      data-view-mode={viewMode}
      style={{ display: 'none' }}
      aria-hidden
    />
  );
}

export { PBR_MATERIAL_CONFIG, stressToColor, validationEmissiveColor };
