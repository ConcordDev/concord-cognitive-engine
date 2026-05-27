/**
 * World Props — Wave G1. Renders interactable props (chairs, mugs,
 * torches, signposts, bookshelves, beds, anvils, wells, lanterns,
 * banners) for the active world. Each prop is a small THREE.Group
 * built from primitive geometry — no external assets.
 *
 * Architecture mirrors `dungeon-interior.ts`:
 *   - `buildPropsForWorld(props)` returns { group, propMeshes, lights }
 *   - `attachWorldProps(scene)` returns { setActive, getNearby, dispose }
 *
 * `propMeshes` is a Map<propId, THREE.Object3D> so the raycaster can
 * highlight a hovered prop and the interaction handler can resolve
 * the click target back to the persisted prop_id.
 *
 * Pulse animation: lit torches/braziers/lanterns get an emissive
 * pulse modulated by their state.lit flag.
 */

import * as THREE from 'three';

export interface WorldProp {
  id: string;
  world_id: string;
  district: string | null;
  prop_kind: string;
  x: number;
  z: number;
  y: number;
  rotation: number;
  variant: string | null;
  durability: number;
  state: { lit?: boolean; occupied_by?: string; lit_at?: number } | null;
}

interface SceneLike {
  add: (obj: THREE.Object3D) => void;
  remove: (obj: THREE.Object3D) => void;
}

type Cleanup = () => void;

// Visual themes per kind — primitive geometry + colour.
const PROP_MESHES: Record<string, (p: WorldProp) => THREE.Group> = {
  chair: (p) => {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.06, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x8b5a2b }),
    );
    seat.position.y = 0.5;
    g.add(seat);
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.6, 0.06),
      new THREE.MeshLambertMaterial({ color: 0x6b4423 }),
    );
    back.position.set(0, 0.8, -0.22);
    g.add(back);
    for (const [dx, dz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.5, 0.05),
        new THREE.MeshLambertMaterial({ color: 0x5b3413 }),
      );
      leg.position.set(dx, 0.25, dz);
      g.add(leg);
    }
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  bench: (p) => {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.08, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x8b5a2b }),
    );
    seat.position.y = 0.5;
    g.add(seat);
    for (const dx of [-0.85, 0.85]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.5, 0.5),
        new THREE.MeshLambertMaterial({ color: 0x5b3413 }),
      );
      leg.position.set(dx, 0.25, 0);
      g.add(leg);
    }
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  table: (p) => {
    const g = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.1, 1.0),
      new THREE.MeshLambertMaterial({ color: 0x7c5a36 }),
    );
    top.position.y = 0.8;
    g.add(top);
    for (const [dx, dz] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.8, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x5b3413 }),
      );
      leg.position.set(dx, 0.4, dz);
      g.add(leg);
    }
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  mug: (p) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.07, 0.15, 12),
      new THREE.MeshLambertMaterial({ color: 0x999999 }),
    );
    body.position.y = 0.08;
    g.add(body);
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x666666 }),
    );
    handle.position.set(0.08, 0.08, 0);
    handle.rotation.y = Math.PI / 2;
    g.add(handle);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  torch: (p) => {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.8, 8),
      new THREE.MeshLambertMaterial({ color: 0x4b3013 }),
    );
    handle.position.y = 0.4;
    g.add(handle);
    const lit = p.state?.lit === true;
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.25, 8),
      new THREE.MeshLambertMaterial({
        color: lit ? 0xffb050 : 0x303030,
        emissive: lit ? 0xff5520 : 0x000000,
        emissiveIntensity: lit ? 0.9 : 0,
      }),
    );
    flame.position.y = 0.92;
    flame.userData = { isPropFlame: true, lit };
    g.add(flame);
    if (lit) {
      const light = new THREE.PointLight(0xff8c40, 0.8, 5, 2);
      light.position.y = 0.95;
      g.add(light);
    }
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  brazier: (p) => {
    const g = new THREE.Group();
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.3, 0.3, 16),
      new THREE.MeshLambertMaterial({ color: 0x3a3a3a }),
    );
    bowl.position.y = 0.55;
    g.add(bowl);
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.12, 0.4, 8),
      new THREE.MeshLambertMaterial({ color: 0x2a2a2a }),
    );
    stand.position.y = 0.2;
    g.add(stand);
    const lit = p.state?.lit !== false;
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.5, 8),
      new THREE.MeshLambertMaterial({
        color: lit ? 0xff8c30 : 0x303030,
        emissive: lit ? 0xff5520 : 0,
        emissiveIntensity: lit ? 1.0 : 0,
      }),
    );
    flame.position.y = 0.95;
    flame.userData = { isPropFlame: true, lit };
    g.add(flame);
    if (lit) {
      const light = new THREE.PointLight(0xff7030, 1.5, 10, 2);
      light.position.y = 1.0;
      g.add(light);
    }
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  bookshelf: (p) => {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.8, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x4b3013 }),
    );
    frame.position.y = 0.9;
    g.add(frame);
    // Three rows of books — coloured spines.
    for (let row = 0; row < 3; row++) {
      const books = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.4, 0.22),
        new THREE.MeshLambertMaterial({ color: [0x8b4513, 0x4a6b8f, 0x6b4a8f][row] }),
      );
      books.position.set(0, 0.4 + row * 0.5, 0);
      g.add(books);
    }
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  bed: (p) => {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.3, 2.0),
      new THREE.MeshLambertMaterial({ color: 0x6b4423 }),
    );
    frame.position.y = 0.2;
    g.add(frame);
    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.15, 1.95),
      new THREE.MeshLambertMaterial({ color: 0xc0a080 }),
    );
    mattress.position.y = 0.42;
    g.add(mattress);
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.1, 0.4),
      new THREE.MeshLambertMaterial({ color: 0xeeeeee }),
    );
    pillow.position.set(0, 0.55, -0.7);
    g.add(pillow);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  anvil: (p) => {
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.5, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x2b2b2b }),
    );
    base.position.y = 0.25;
    g.add(base);
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.18, 0.35),
      new THREE.MeshLambertMaterial({ color: 0x1f1f1f }),
    );
    top.position.y = 0.59;
    g.add(top);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  well: (p) => {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.85, 0.8, 24),
      new THREE.MeshLambertMaterial({ color: 0x7c7c7c }),
    );
    wall.position.y = 0.4;
    g.add(wall);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 24),
      new THREE.MeshBasicMaterial({ color: 0x2848a8, transparent: true, opacity: 0.7 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.75;
    g.add(water);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  signpost: (p) => {
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 2.0, 8),
      new THREE.MeshLambertMaterial({ color: 0x4b3013 }),
    );
    post.position.y = 1.0;
    g.add(post);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.35, 0.05),
      new THREE.MeshLambertMaterial({ color: 0xa0784a }),
    );
    board.position.y = 1.7;
    g.add(board);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  lantern: (p) => {
    const g = new THREE.Group();
    const cage = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.35, 0.25),
      new THREE.MeshLambertMaterial({ color: 0x202020, transparent: true, opacity: 0.7 }),
    );
    cage.position.y = 0;
    g.add(cage);
    const lit = p.state?.lit !== false;
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshLambertMaterial({
        color: lit ? 0xffe080 : 0x404040,
        emissive: lit ? 0xffd060 : 0,
        emissiveIntensity: lit ? 1.2 : 0,
      }),
    );
    bulb.userData = { isPropFlame: true, lit };
    g.add(bulb);
    if (lit) {
      const light = new THREE.PointLight(0xffc060, 0.7, 7, 2);
      g.add(light);
    }
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
  banner: (p) => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6),
      new THREE.MeshLambertMaterial({ color: 0x3b2a13 }),
    );
    pole.position.y = 1.25;
    g.add(pole);
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.6),
      new THREE.MeshLambertMaterial({
        color: 0xa02838,
        side: THREE.DoubleSide,
      }),
    );
    cloth.position.set(0.5, 1.6, 0);
    cloth.userData = { isBanner: true };
    g.add(cloth);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotation;
    return g;
  },
};

/**
 * Build a single prop's mesh. Falls back to a small grey cube for any
 * unknown prop_kind.
 */
export function buildProp(p: WorldProp): THREE.Group {
  const builder = PROP_MESHES[p.prop_kind];
  if (builder) return builder(p);
  const fallback = new THREE.Group();
  fallback.add(new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x555555 }),
  ));
  fallback.position.set(p.x, p.y, p.z);
  return fallback;
}

/**
 * Build the full set of props for a world. Returns the parent group
 * + a Map<propId, mesh> for raycaster resolution + the prop snapshot
 * by id (so the interact dispatcher can read state without a round-trip).
 */
export function buildPropsForWorld(props: WorldProp[]): {
  group: THREE.Group;
  propMeshes: Map<string, THREE.Object3D>;
  propData: Map<string, WorldProp>;
} {
  const group = new THREE.Group();
  group.name = 'world-props';
  const propMeshes = new Map<string, THREE.Object3D>();
  const propData = new Map<string, WorldProp>();
  for (const p of props) {
    try {
      const m = buildProp(p);
      m.userData = { ...m.userData, propId: p.id, propKind: p.prop_kind };
      // Tag every descendant so any raycast hit traces back.
      m.traverse((c) => { c.userData = { ...c.userData, propId: p.id, propKind: p.prop_kind }; });
      group.add(m);
      propMeshes.set(p.id, m);
      propData.set(p.id, p);
    } catch { /* skip malformed */ }
  }
  return { group, propMeshes, propData };
}

/**
 * Resolve a raycast intersection to its parent prop, walking up the
 * Object3D parent chain until we find userData.propId.
 */
export function findPropAncestor(obj: THREE.Object3D | null): { propId: string; propKind: string } | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const ud = cur.userData as { propId?: string; propKind?: string } | undefined;
    if (ud?.propId) return { propId: ud.propId, propKind: ud.propKind || '' };
    cur = cur.parent;
  }
  return null;
}

/**
 * Attach the world-props renderer to a scene. The caller switches
 * which world's props are mounted via `setActive(worldId)`. Returns
 * propMeshes/propData maps for the raycaster + interaction layer.
 */
export function attachWorldProps(scene: SceneLike): {
  setActive: (worldId: string | null) => Promise<void>;
  getPropMeshes: () => Map<string, THREE.Object3D>;
  getPropData: () => Map<string, WorldProp>;
  dispose: Cleanup;
} {
  let current: {
    worldId: string;
    group: THREE.Group;
    propMeshes: Map<string, THREE.Object3D>;
    propData: Map<string, WorldProp>;
    spawnedAt: number;
  } | null = null;
  let animFrame: number | null = null;
  let disposed = false;

  const detach = () => {
    if (!current) return;
    try { scene.remove(current.group); } catch { /* ok */ }
    current.group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry?.dispose) try { m.geometry.dispose(); } catch { /* ok */ }
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => { try { mm.dispose(); } catch { /* ok */ } });
      else if (mat?.dispose) try { mat.dispose(); } catch { /* ok */ }
    });
    current = null;
  };

  const setActive = async (worldId: string | null) => {
    if (disposed) return;
    if (current && current.worldId === worldId) return;
    detach();
    if (!worldId) return;
    try {
      const r = await fetch(`/api/world-props?worldId=${encodeURIComponent(worldId)}`, { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = await r.json();
      if (!j?.ok || !Array.isArray(j.props)) return;
      const built = buildPropsForWorld(j.props as WorldProp[]);
      scene.add(built.group);
      current = {
        worldId,
        group: built.group,
        propMeshes: built.propMeshes,
        propData: built.propData,
        spawnedAt: performance.now(),
      };
    } catch { /* best-effort */ }
  };

  // Pulse animation for lit torches/braziers + slow banner sway.
  const tick = () => {
    if (disposed) return;
    if (current) {
      const t = (performance.now() - current.spawnedAt) / 1000;
      current.group.traverse((c) => {
        const ud = c.userData as { isPropFlame?: boolean; lit?: boolean; isBanner?: boolean } | undefined;
        if (ud?.isPropFlame && ud?.lit) {
          const m = (c as THREE.Mesh).material as THREE.MeshLambertMaterial;
          if (m?.emissive) m.emissiveIntensity = 0.7 + Math.sin(t * 6 + (c.position.x + c.position.z)) * 0.25;
        }
        if (ud?.isBanner) {
          c.rotation.y = Math.sin(t * 0.7 + c.position.x * 0.3) * 0.12;
          c.scale.x = 1 + Math.sin(t * 1.4) * 0.04;
        }
      });
    }
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);

  return {
    setActive,
    getPropMeshes: () => current?.propMeshes ?? new Map(),
    getPropData: () => current?.propData ?? new Map(),
    dispose: () => {
      disposed = true;
      if (animFrame != null) cancelAnimationFrame(animFrame);
      detach();
    },
  };
}

// Default verb + clip table — mirror of server/lib/world-props.js#PROP_KIND_CATALOG.
// Kept here so the client can render the prompt without a round-trip.
export const PROP_CLIENT_CATALOG: Record<string, { verbs: string[]; label: Record<string, string>; clip: Record<string, string> }> = {
  chair:     { verbs: ['sit'],           label: { sit: 'Sit' },           clip: { sit: 'sit' } },
  bench:     { verbs: ['sit', 'lean'],   label: { sit: 'Sit', lean: 'Lean' }, clip: { sit: 'sit', lean: 'lean' } },
  table:     { verbs: ['lean'],          label: { lean: 'Lean' },         clip: { lean: 'lean' } },
  mug:       { verbs: ['drink'],         label: { drink: 'Drink' },       clip: { drink: 'drink' } },
  torch:     { verbs: ['light'],         label: { light: 'Light' },       clip: { light: 'light-torch' } },
  brazier:   { verbs: ['light'],         label: { light: 'Stoke' },       clip: { light: 'light-torch' } },
  bookshelf: { verbs: ['read'],          label: { read: 'Read' },         clip: { read: 'read' } },
  bed:       { verbs: ['sleep'],         label: { sleep: 'Rest' },        clip: { sleep: 'sleep' } },
  anvil:     { verbs: ['knock'],         label: { knock: 'Strike' },      clip: { knock: 'hammer' } },
  well:      { verbs: ['drink'],         label: { drink: 'Drink' },       clip: { drink: 'drink' } },
  signpost:  { verbs: ['read'],          label: { read: 'Read' },         clip: { read: 'read' } },
  lantern:   { verbs: ['light'],         label: { light: 'Light' },       clip: { light: 'light-torch' } },
  banner:    { verbs: ['touch'],         label: { touch: 'Touch' },       clip: { touch: 'hand-extend' } },
};

export function defaultVerbFor(kind: string): string | null {
  return PROP_CLIENT_CATALOG[kind]?.verbs?.[0] ?? null;
}

export function clipFor(kind: string, verb: string): string | null {
  return PROP_CLIENT_CATALOG[kind]?.clip?.[verb] ?? null;
}

export function labelFor(kind: string, verb: string): string {
  return PROP_CLIENT_CATALOG[kind]?.label?.[verb] ?? verb;
}
