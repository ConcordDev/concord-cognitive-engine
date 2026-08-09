/**
 * Procedural interior decoration — SUBSTRATE FALLBACK.
 *
 * Default interior layouts that ship for every building archetype so
 * walking inside any tavern / archive / forge / market / tower reveals
 * recognisable furniture from frame 1. Player-authored interiors
 * produced by the `whiteboard` lens (CRDT blueprint canvas → building
 * DTU per Wave 6 of the content engine) override the procedural layout
 * once they win marketplace canon for a given archetype + faction.
 *
 * When a building's zoom level transitions to 'interior', this module
 * spawns archetype-appropriate props:
 *   - tavern     → fireplace + table + bench cluster + rug
 *   - archive    → shelves with scrolls + reading table + rug
 *   - forge      → anvil + bellows + tool rack
 *   - market     → stall counter + sack pile
 *   - tower      → spiral staircase mock + window slit + standing torch
 *   - restaurant → kitchen counter + stove + hood + fridge + dishrack + table
 *
 * Each prop is a simple primitive group attached as a child of the
 * caller-provided buildingGroup, so disposing the building auto-cleans
 * the decor.
 *
 * Materials come from the procedural-texture generator (which itself
 * accepts authored DTU overrides via pbr-loader) so the surfaces read
 * as wood / cloth / stone / metal instead of flat colour, and improve
 * automatically as the content engine produces authored textures.
 *
 * Real-mesh-first upgrade (2026-08-08): table / rug / shelf are backed by
 * real CC0 GLBs (KayKit-Furniture-Bits-1.0, Kay Lousberg — see
 * public/models/CREDITS.md) resolved via the same `loadAsset`/`AssetKind`
 * pipeline the rest of the world lens uses (`kind: 'prop'`, the one
 * declared AssetKind that had zero real files behind it until now). The
 * primitive is built and returned SYNCHRONOUSLY exactly as before — the
 * real mesh is a best-effort async upgrade that swaps in on load and is a
 * pure no-op (primitive stays) on any failure, so this never changes the
 * function's synchronous contract or `propCount()`. Two archetype-specific
 * extras (cabinet in market, armchair in tavern) are ADDED dressing with no
 * procedural equivalent — honestly absent if the real mesh never resolves.
 */

import type * as THREE_NS from 'three';
import type { PBRTextureSet } from './procedural-texture';
import { loadAsset } from './asset-loader';

/**
 * Best-effort real-mesh upgrade for a primitive already added to `group`.
 * On success, clones the resolved GLB at `target`'s transform (scaled to
 * `target`'s own bounding-box height so it reads at the same size as the
 * primitive it replaces) and hides — never disposes — the primitive, so
 * `dispose()`'s existing traversal still cleans everything up. On any
 * failure (asset not found, network error, parse error) `target` simply
 * stays visible — the honest fallback every other real-asset path in this
 * codebase uses.
 */
function upgradeToRealMesh(
  THREE: typeof THREE_NS,
  group: THREE_NS.Group,
  target: THREE_NS.Object3D,
  assetId: string,
): void {
  loadAsset({ kind: 'prop', id: assetId }, THREE)
    .then((scene) => {
      if (!scene) return;
      const real = (scene as THREE_NS.Object3D).clone(true);
      const box = new THREE.Box3().setFromObject(real);
      const size = box.getSize(new THREE.Vector3());
      const targetBox = new THREE.Box3().setFromObject(target);
      const targetSize = targetBox.getSize(new THREE.Vector3());
      if (size.y > 0.001 && targetSize.y > 0.001) {
        real.scale.multiplyScalar(targetSize.y / size.y);
      }
      real.position.copy(target.position);
      real.rotation.copy(target.rotation);
      real.userData.isRealMeshUpgrade = true;
      real.userData.sourceAssetId = assetId;
      group.add(real);
      target.visible = false;
    })
    .catch(() => { /* honest fallback: primitive stays visible */ });
}

/**
 * Add a brand-new real-mesh prop with no procedural equivalent. Honestly
 * a no-op if the asset never resolves — never fabricates a fallback shape
 * for dressing that has none.
 */
function addRealMeshExtra(
  THREE: typeof THREE_NS,
  group: THREE_NS.Group,
  assetId: string,
  position: [number, number, number],
  rotationY = 0,
): void {
  loadAsset({ kind: 'prop', id: assetId }, THREE)
    .then((scene) => {
      if (!scene) return;
      const real = (scene as THREE_NS.Object3D).clone(true);
      real.position.set(...position);
      real.rotation.y = rotationY;
      real.userData.isRealMeshUpgrade = true;
      real.userData.sourceAssetId = assetId;
      group.add(real);
    })
    .catch(() => { /* honest absence: no procedural equivalent exists */ });
}

export type InteriorArchetype = 'tavern' | 'archive' | 'forge' | 'market' | 'tower' | 'restaurant';

export interface InteriorDecorOptions {
  archetype: InteriorArchetype;
  seed?:     number;
  /** Box size of the interior in metres (x, y, z). Default 12×6×12. */
  size?: { x: number; y: number; z: number };
  /** Pre-loaded PBR sets keyed by material name (wood, stone, cloth, metal). */
  pbrSets?: Partial<Record<'wood' | 'stone' | 'cloth' | 'metal', PBRTextureSet>>;
}

export interface InteriorDecorAPI {
  group: THREE_NS.Group;
  dispose(): void;
  propCount(): number;
}

/** Build a small material from a PBR set or fallback to a plain colour. */
function makeMaterial(
  THREE: typeof THREE_NS,
  pbr: PBRTextureSet | undefined,
  fallbackColor: number,
  options: { roughness?: number; metalness?: number } = {},
): THREE_NS.MeshStandardMaterial {
  if (pbr) {
    return new THREE.MeshStandardMaterial({
      map: pbr.albedo,
      normalMap: pbr.normal,
      roughnessMap: pbr.roughness,
      aoMap: pbr.ao,
      roughness: options.roughness ?? 0.85,
      metalness: options.metalness ?? 0.05,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: fallbackColor,
    roughness: options.roughness ?? 0.85,
    metalness: options.metalness ?? 0.05,
  });
}

function buildRug(THREE: typeof THREE_NS, clothPBR: PBRTextureSet | undefined, sx: number, sz: number): THREE_NS.Mesh {
  const geom = new THREE.PlaneGeometry(sx, sz);
  const mat = makeMaterial(THREE, clothPBR, 0x6e2a2c, { roughness: 0.95 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.005;
  mesh.receiveShadow = true;
  return mesh;
}

function buildFireplace(THREE: typeof THREE_NS, stonePBR: PBRTextureSet | undefined): THREE_NS.Group {
  const grp = new THREE.Group();
  const mat = makeMaterial(THREE, stonePBR, 0x5a5651, { roughness: 0.95 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 0.6), mat);
  base.position.y = 0.7; grp.add(base);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.6, 0.5), mat);
  chimney.position.y = 1.4 + 1.3 - 0.5; grp.add(chimney);
  // Embers — small additive orange light disk
  const ember = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xff7030, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }),
  );
  ember.rotation.x = -Math.PI / 2;
  ember.position.set(0, 0.06, 0.05);
  grp.add(ember);
  // Subtle point light from the fire
  const pl = new THREE.PointLight(0xff8a40, 1.2, 8);
  pl.position.set(0, 0.5, 0.2);
  grp.add(pl);
  return grp;
}

function buildTable(THREE: typeof THREE_NS, woodPBR: PBRTextureSet | undefined): THREE_NS.Group {
  const grp = new THREE.Group();
  const mat = makeMaterial(THREE, woodPBR, 0x705133, { roughness: 0.80 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.9), mat);
  top.position.y = 0.74; grp.add(top);
  for (const [x, z] of [[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.74, 0.06), mat);
    leg.position.set(x, 0.37, z);
    grp.add(leg);
  }
  return grp;
}

function buildBench(THREE: typeof THREE_NS, woodPBR: PBRTextureSet | undefined, length = 1.6): THREE_NS.Group {
  const grp = new THREE.Group();
  const mat = makeMaterial(THREE, woodPBR, 0x6a4a30, { roughness: 0.85 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.36), mat);
  seat.position.y = 0.44; grp.add(seat);
  for (const x of [-length / 2 + 0.1, length / 2 - 0.1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.34), mat);
    leg.position.set(x, 0.22, 0);
    grp.add(leg);
  }
  return grp;
}

function buildShelfWithScrolls(THREE: typeof THREE_NS, woodPBR: PBRTextureSet | undefined): THREE_NS.Group {
  const grp = new THREE.Group();
  const mat = makeMaterial(THREE, woodPBR, 0x4f3920, { roughness: 0.85 });
  // 4 horizontal shelves + 2 verticals
  for (let i = 0; i < 4; i++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.3), mat);
    shelf.position.set(0, 0.25 + i * 0.45, 0);
    grp.add(shelf);
  }
  for (const x of [-0.8, 0.8]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.0, 0.3), mat);
    post.position.set(x, 1.0, 0);
    grp.add(post);
  }
  // Scrolls
  const scrollMat = new THREE.MeshStandardMaterial({ color: 0xc8a878, roughness: 0.9 });
  for (let shelf = 0; shelf < 4; shelf++) {
    for (let i = 0; i < 5; i++) {
      const scroll = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.25, 8),
        scrollMat,
      );
      scroll.position.set(-0.6 + i * 0.3, 0.4 + shelf * 0.45, 0);
      scroll.rotation.z = Math.PI / 2;
      grp.add(scroll);
    }
  }
  return grp;
}

function buildCurtain(THREE: typeof THREE_NS, clothPBR: PBRTextureSet | undefined, height: number): THREE_NS.Mesh {
  const geom = new THREE.PlaneGeometry(1.2, height);
  const mat = makeMaterial(THREE, clothPBR, 0x5a3a48, { roughness: 0.92 });
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.isCape = true; // hook into existing secondary-physics
  return mesh;
}

function buildAnvil(THREE: typeof THREE_NS, metalPBR: PBRTextureSet | undefined, stonePBR: PBRTextureSet | undefined): THREE_NS.Group {
  const grp = new THREE.Group();
  const metalMat = makeMaterial(THREE, metalPBR, 0x46484a, { roughness: 0.35, metalness: 0.7 });
  const stoneMat = makeMaterial(THREE, stonePBR, 0x4d4843, { roughness: 0.95 });
  const block = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.4), stoneMat);
  block.position.y = 0.3; grp.add(block);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, 0.36), metalMat);
  top.position.y = 0.69; grp.add(top);
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 8), metalMat);
  horn.position.set(-0.55, 0.69, 0); horn.rotation.z = Math.PI / 2;
  grp.add(horn);
  return grp;
}

function buildStallCounter(THREE: typeof THREE_NS, woodPBR: PBRTextureSet | undefined): THREE_NS.Group {
  const grp = new THREE.Group();
  const mat = makeMaterial(THREE, woodPBR, 0x5d4225, { roughness: 0.85 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.0, 0.5), mat);
  counter.position.y = 0.5; grp.add(counter);
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.05, 0.7), mat);
  top.position.y = 1.02; grp.add(top);
  return grp;
}

function buildStandingTorch(THREE: typeof THREE_NS, metalPBR: PBRTextureSet | undefined): THREE_NS.Group {
  const grp = new THREE.Group();
  const metalMat = makeMaterial(THREE, metalPBR, 0x3d3d3d, { roughness: 0.5, metalness: 0.7 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 8), metalMat);
  post.position.y = 1.0; grp.add(post);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.15, 0.20, 12), metalMat);
  bowl.position.y = 2.0; grp.add(bowl);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.4, 8),
    new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }),
  );
  flame.position.y = 2.3; grp.add(flame);
  const pl = new THREE.PointLight(0xff9050, 1.2, 6);
  pl.position.y = 2.3; grp.add(pl);
  return grp;
}

/**
 * Decorate an interior with archetype-appropriate props.
 */
export function decorateInterior(
  THREE: typeof THREE_NS,
  options: InteriorDecorOptions,
): InteriorDecorAPI {
  const group = new THREE.Group();
  group.name = `interior-decor-${options.archetype}`;
  const size = options.size ?? { x: 12, y: 6, z: 12 };
  const pbr = options.pbrSets ?? {};
  const props: THREE_NS.Object3D[] = [];

  switch (options.archetype) {
    case 'tavern': {
      const rug = buildRug(THREE, pbr.cloth, size.x * 0.6, size.z * 0.4);
      rug.position.set(0, 0.005, 0);
      group.add(rug); props.push(rug);
      upgradeToRealMesh(THREE, group, rug, 'furniture_rug');

      const fire = buildFireplace(THREE, pbr.stone);
      fire.position.set(0, 0, -size.z / 2 + 0.3);
      group.add(fire); props.push(fire);

      const table = buildTable(THREE, pbr.wood);
      table.position.set(0, 0, 0);
      group.add(table); props.push(table);
      upgradeToRealMesh(THREE, group, table, 'furniture_table');

      const benchA = buildBench(THREE, pbr.wood);
      benchA.position.set(0, 0, -0.7);
      const benchB = buildBench(THREE, pbr.wood);
      benchB.position.set(0, 0, 0.7);
      group.add(benchA); group.add(benchB);
      props.push(benchA, benchB);

      const torch = buildStandingTorch(THREE, pbr.metal);
      torch.position.set(-size.x / 2 + 0.5, 0, size.z / 2 - 0.5);
      group.add(torch); props.push(torch);

      const curtain = buildCurtain(THREE, pbr.cloth, size.y * 0.7);
      curtain.position.set(size.x / 2 - 0.05, size.y * 0.5, 0);
      curtain.rotation.y = -Math.PI / 2;
      group.add(curtain); props.push(curtain);

      // Extra dressing near the fire — no procedural equivalent, real-mesh only.
      addRealMeshExtra(THREE, group, 'furniture_armchair', [size.x / 2 - 1.2, 0, -size.z / 2 + 1.2], Math.PI * 0.75);
      break;
    }
    case 'archive': {
      const rug = buildRug(THREE, pbr.cloth, size.x * 0.4, size.z * 0.3);
      rug.position.set(0, 0.005, 0);
      group.add(rug); props.push(rug);
      upgradeToRealMesh(THREE, group, rug, 'furniture_rug');

      // upgradeToRealMesh hides the WHOLE primitive group on success —
      // buildShelfWithScrolls's procedural scroll cylinders are children of
      // that same group, so a successful upgrade replaces frame+scrolls
      // together with the real (unfurnished) shelf mesh. Honest trade-off:
      // a real KayKit shelf silhouette in place of procedural scroll props.
      const shelfA = buildShelfWithScrolls(THREE, pbr.wood);
      shelfA.position.set(-size.x / 2 + 0.3, 0, 0);
      shelfA.rotation.y = Math.PI / 2;
      group.add(shelfA); props.push(shelfA);
      upgradeToRealMesh(THREE, group, shelfA, 'furniture_shelf');

      const shelfB = buildShelfWithScrolls(THREE, pbr.wood);
      shelfB.position.set(size.x / 2 - 0.3, 0, 0);
      shelfB.rotation.y = -Math.PI / 2;
      group.add(shelfB); props.push(shelfB);
      upgradeToRealMesh(THREE, group, shelfB, 'furniture_shelf');

      const table = buildTable(THREE, pbr.wood);
      table.position.set(0, 0, 0);
      group.add(table); props.push(table);
      upgradeToRealMesh(THREE, group, table, 'furniture_table');
      break;
    }
    case 'forge': {
      const anvil = buildAnvil(THREE, pbr.metal, pbr.stone);
      anvil.position.set(0, 0, 0);
      group.add(anvil); props.push(anvil);

      const torchA = buildStandingTorch(THREE, pbr.metal);
      torchA.position.set(-size.x / 2 + 0.5, 0, -size.z / 2 + 0.5);
      group.add(torchA);
      const torchB = buildStandingTorch(THREE, pbr.metal);
      torchB.position.set(size.x / 2 - 0.5, 0, -size.z / 2 + 0.5);
      group.add(torchB);
      props.push(torchA, torchB);
      break;
    }
    case 'market': {
      const counter = buildStallCounter(THREE, pbr.wood);
      counter.position.set(0, 0, -size.z / 2 + 0.5);
      group.add(counter); props.push(counter);

      // Sack pile
      const sackMat = makeMaterial(THREE, pbr.cloth, 0x6d553a);
      for (let i = 0; i < 5; i++) {
        const sack = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), sackMat);
        sack.position.set((i - 2) * 0.4, 0.35, size.z / 2 - 0.6);
        group.add(sack); props.push(sack);
      }

      // Extra dressing beside the stall — no procedural equivalent, real-mesh only.
      addRealMeshExtra(THREE, group, 'furniture_cabinet', [-size.x / 2 + 0.6, 0, -size.z / 2 + 0.6], Math.PI / 4);

      // Crate/barrel/pallet cluster opposite the cabinet — KayKit-Prototype-Bits-1.0
      // world-dressing, same honest-absence contract as every other extra.
      addRealMeshExtra(THREE, group, 'market_barrel', [size.x / 2 - 0.8, 0, -size.z / 2 + 0.7], 0.4);
      addRealMeshExtra(THREE, group, 'market_crate', [size.x / 2 - 1.4, 0, -size.z / 2 + 0.9], 0.9);
      addRealMeshExtra(THREE, group, 'market_pallet', [size.x / 2 - 1.1, 0, -size.z / 2 + 1.5], 0);
      break;
    }
    case 'tower': {
      const torch = buildStandingTorch(THREE, pbr.metal);
      torch.position.set(0, 0, 0);
      group.add(torch); props.push(torch);

      // Window-slit glow (vertical light shaft)
      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, size.y * 0.4, 0.1),
        new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.4 }),
      );
      glow.position.set(size.x / 2 - 0.1, size.y * 0.6, 0);
      group.add(glow); props.push(glow);
      break;
    }
    case 'restaurant': {
      // A kitchen — the real Diner-Dash-style restaurant mechanic's honest
      // 3D interior (2026-08-08), sourced from KayKit-Restaurant-Bits-1.0
      // (CC0, Kay Lousberg — see CREDITS.md). Mirrors the market case's
      // shape: one primitive-then-real-mesh-upgraded base piece (the
      // counter) plus pure real-mesh extras for the rest of the line —
      // this archetype was designed real-mesh-first from the start rather
      // than retrofitted, since KayKit-Restaurant-Bits-1.0 has no
      // procedural-box equivalent worth hand-building for a stove/hood/
      // fridge/dishrack.
      const counter = buildStallCounter(THREE, pbr.wood);
      counter.position.set(0, 0, -size.z / 2 + 0.5);
      group.add(counter); props.push(counter);
      upgradeToRealMesh(THREE, group, counter, 'kitchen_counter');

      addRealMeshExtra(THREE, group, 'kitchen_stove', [-size.x / 2 + 1.2, 0, -size.z / 2 + 0.5], 0);
      addRealMeshExtra(THREE, group, 'kitchen_hood', [-size.x / 2 + 1.2, size.y * 0.55, -size.z / 2 + 0.5], 0);
      addRealMeshExtra(THREE, group, 'kitchen_fridge', [size.x / 2 - 0.8, 0, -size.z / 2 + 0.6], -Math.PI / 2);
      addRealMeshExtra(THREE, group, 'kitchen_dishrack', [size.x / 2 - 1.8, 0, -size.z / 2 + 0.5], 0);
      addRealMeshExtra(THREE, group, 'kitchen_table', [0, 0, size.z / 2 - 1.5], 0);
      break;
    }
  }

  return {
    group,
    propCount() { return props.length; },
    dispose() {
      // Dispose geometry / materials of all created props
      group.traverse((obj) => {
        const m = obj as THREE_NS.Mesh;
        try { (m.geometry as THREE_NS.BufferGeometry | undefined)?.dispose(); } catch { /* idempotent */ }
        const mat = m.material as THREE_NS.Material | THREE_NS.Material[] | undefined;
        if (Array.isArray(mat)) {
          for (const x of mat) { try { x.dispose(); } catch { /* idempotent */ } }
        } else if (mat) {
          try { mat.dispose(); } catch { /* idempotent */ }
        }
      });
      try { group.parent?.remove(group); } catch { /* idempotent */ }
    },
  };
}
