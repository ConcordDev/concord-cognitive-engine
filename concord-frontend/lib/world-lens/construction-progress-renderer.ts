// concord-frontend/lib/world-lens/construction-progress-renderer.ts
//
// Render-Everything WS2.3 — buildings under construction visibly RISE.
//
// `world_buildings` carries `state` + `construction_progress_pct` (0..100),
// accrued by the npc-labor-world cycle as builder NPCs/players work a site.
// Standing buildings are drawn by BuildingRenderer3D; this additive renderer
// overlays *only* in-progress sites so a build reads as a real raising:
//
//   • a translucent "rising shell" the building footprint wide, whose HEIGHT is
//     `targetHeight × pct/100` — so the structure grows out of the ground as
//     work accrues (Medieval-Dynasty / Bellwright "visible labor" payoff);
//   • four scaffold poles at the footprint corners that fade out near 100%;
//   • once `state === 'standing'` (or pct ≥ 100) the overlay is disposed and
//     BuildingRenderer3D's finished mesh is all that remains.
//
// Pure helper `constructionVisual(building)` is unit-testable; the renderer is a
// factory `(parentGroup, opts) => { update, dispose, refresh }` matching the
// other infrastructure-layer renderers. Uses ONLY real server data; a bad fetch
// renders nothing (no fake sites). All network is wrapped in try/catch.

import * as THREE from "three";

export interface BuildingRow {
  id: string;
  building_type?: string;
  state?: string;
  construction_progress_pct?: number;
  x?: number;
  y?: number;
  z?: number;
  width?: number;
  depth?: number;
  height?: number;
}

export interface ConstructionProgressRendererOpts {
  worldId: string;
  authToken?: () => string | null;
  pollMs?: number;
  apiBase?: string;
  /** Test seam — supply rows directly instead of fetching. */
  fetchBuildings?: () => Promise<BuildingRow[]>;
}

export interface ConstructionVisual {
  /** True when this building should show a construction overlay. */
  active: boolean;
  /** 0..1 fraction complete. */
  fraction: number;
  /** Current revealed height in metres (footprintHeight × fraction). */
  revealedHeight: number;
  /** Footprint width / depth in metres. */
  width: number;
  depth: number;
  /** Scaffold opacity (fades out as work completes). */
  scaffoldOpacity: number;
}

const DEFAULT_HEIGHT = 8;
const DEFAULT_FOOTPRINT = 10;
const MIN_REVEAL = 0.4; // always show at least a foundation slab

/**
 * PURE: map a building row to its construction overlay attributes.
 * active === false for standing / collapsed / ≥100% buildings (no overlay).
 * fraction clamps to [0,1]; revealedHeight grows with fraction; scaffold fades
 * from full opacity at 0% to 0 at 100%.
 */
export function constructionVisual(b: BuildingRow): ConstructionVisual {
  const pct = Number(b.construction_progress_pct);
  const state = String(b.state ?? "").toLowerCase();
  const hasPct = Number.isFinite(pct);
  const fraction = Math.max(0, Math.min(1, (hasPct ? pct : 0) / 100));
  // Only overlay when there's an EXPLICIT construction signal: the building is
  // in the 'construction' state, OR it carries a real partial progress value
  // (>0 and <100). A row with no state + no progress is NOT treated as a site —
  // otherwise every legacy NULL-state building would sprout scaffolding.
  const inProgress = state === "construction" || (hasPct && pct > 0 && pct < 100);
  const notDone = state !== "standing" && state !== "collapsed" && fraction < 1;
  const active = inProgress && notDone;

  const height = Number(b.height) > 0 ? Number(b.height) : DEFAULT_HEIGHT;
  const width = Number(b.width) > 0 ? Number(b.width) : DEFAULT_FOOTPRINT;
  const depth = Number(b.depth) > 0 ? Number(b.depth) : DEFAULT_FOOTPRINT;

  return {
    active,
    fraction,
    revealedHeight: Math.max(MIN_REVEAL, height * fraction),
    width,
    depth,
    scaffoldOpacity: 0.55 * (1 - fraction),
  };
}

interface TrackedSite {
  group: THREE.Group;
  shell: THREE.Mesh;
  poles: THREE.Mesh[];
  targetHeight: number;
  width: number;
  depth: number;
}

const SHELL_COLOR = 0xb8a07a; // raw timber / sandstone
const SCAFFOLD_COLOR = 0x6b4f2a;

function buildSite(visual: ConstructionVisual): TrackedSite {
  const group = new THREE.Group();

  // Rising shell — a box anchored at the ground, height set per-frame.
  const shellGeo = new THREE.BoxGeometry(visual.width, 1, visual.depth);
  const shellMat = new THREE.MeshStandardMaterial({
    color: SHELL_COLOR,
    transparent: true,
    opacity: 0.7,
    roughness: 0.9,
    metalness: 0.0,
  });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  group.add(shell);

  // Four scaffold poles at the footprint corners.
  const poles: THREE.Mesh[] = [];
  const poleMat = new THREE.MeshStandardMaterial({
    color: SCAFFOLD_COLOR,
    transparent: true,
    opacity: visual.scaffoldOpacity,
    roughness: 1.0,
  });
  const hx = visual.width / 2;
  const hz = visual.depth / 2;
  const corners: Array<[number, number]> = [
    [hx, hz],
    [-hx, hz],
    [hx, -hz],
    [-hx, -hz],
  ];
  for (const [cx, cz] of corners) {
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 1, 6);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(cx, 0, cz);
    group.add(pole);
    poles.push(pole);
  }

  return { group, shell, poles, targetHeight: 0, width: visual.width, depth: visual.depth };
}

function disposeSite(site: TrackedSite, parent: THREE.Group): void {
  try { parent.remove(site.group); } catch { /* idempotent */ }
  try { (site.shell.geometry as THREE.BufferGeometry).dispose(); } catch { /* idempotent */ }
  try { (site.shell.material as THREE.Material).dispose(); } catch { /* idempotent */ }
  for (const p of site.poles) {
    try { (p.geometry as THREE.BufferGeometry).dispose(); } catch { /* idempotent */ }
  }
  // Poles share one material — dispose once.
  try { (site.poles[0]?.material as THREE.Material)?.dispose(); } catch { /* idempotent */ }
}

export interface ConstructionProgressRenderer {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  refresh(): Promise<void>;
}

export function createConstructionProgressRenderer(
  parentGroup: THREE.Group,
  opts: ConstructionProgressRendererOpts,
): ConstructionProgressRenderer {
  const pollMs = opts.pollMs ?? 5000;
  const apiBase = opts.apiBase ?? "";
  const url = `${apiBase}/api/worlds/${opts.worldId}/buildings`;
  const tracked = new Map<string, { site: TrackedSite; target: ConstructionVisual }>();
  let disposed = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function reconcile(rows: BuildingRow[]): void {
    if (disposed) return;
    const seen = new Set<string>();
    for (const b of rows) {
      if (!b || !b.id) continue;
      const visual = constructionVisual(b);
      if (!visual.active) continue; // standing/collapsed/done — no overlay
      seen.add(b.id);
      let entry = tracked.get(b.id);
      if (!entry) {
        const site = buildSite(visual);
        site.group.position.set(Number(b.x) || 0, Number(b.y) || 0, Number(b.z) || 0);
        parentGroup.add(site.group);
        entry = { site, target: visual };
        tracked.set(b.id, entry);
      } else {
        entry.target = visual;
      }
      entry.site.targetHeight = visual.revealedHeight;
    }
    // Remove sites no longer in-progress (finished / collapsed / gone).
    for (const [id, entry] of tracked) {
      if (!seen.has(id)) {
        disposeSite(entry.site, parentGroup);
        tracked.delete(id);
      }
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      let rows: BuildingRow[];
      if (opts.fetchBuildings) {
        rows = await opts.fetchBuildings();
      } else {
        const headers: Record<string, string> = { Accept: "application/json" };
        const token = opts.authToken ? opts.authToken() : null;
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return;
        const data = (await res.json()) as { buildings?: BuildingRow[] };
        if (!data || !Array.isArray(data.buildings)) return;
        rows = data.buildings;
      }
      reconcile(rows);
    } catch {
      // Network/parse failure → render nothing new.
    }
  }

  void refresh();
  intervalId = setInterval(() => void refresh(), pollMs);

  function update(delta: number): void {
    if (disposed) return;
    const lerp = Math.min(1, delta * 2.5); // ~400ms catch-up so the rise reads as growth
    for (const { site, target } of tracked.values()) {
      const cur = site.shell.scale.y * 1; // shell base geo is 1m tall → scale.y === height
      const next = cur + (site.targetHeight - cur) * lerp;
      site.shell.scale.y = Math.max(0.01, next);
      site.shell.position.y = site.shell.scale.y / 2; // anchor base at ground
      // Poles stand a touch taller than the revealed shell.
      const poleH = Math.max(1, site.targetHeight + 1.5);
      for (const p of site.poles) {
        p.scale.y = poleH;
        p.position.y = poleH / 2;
        const mat = p.material as THREE.MeshStandardMaterial;
        mat.opacity = target.scaffoldOpacity;
      }
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    for (const { site } of tracked.values()) disposeSite(site, parentGroup);
    tracked.clear();
  }

  return { update, dispose, refresh };
}
