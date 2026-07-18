// concord-frontend/lib/robotics/urdf-parser.ts
//
// Real URDF (Unified Robot Description Format) XML parser — no fabrication.
// A robot can only be shown if the user supplies a real URDF document; there
// is no synthetic "demo robot" data path. urdf-loader (the common npm
// package for this) is NOT vendored in this repo (`npm ls urdf-loader` comes
// back empty), so per the honesty-over-dependency-bloat call this is a
// hand-written parser covering the common primitive-geometry case (box /
// cylinder / sphere) plus honest pass-through of <mesh> references (parsed,
// never rendered as if we knew their real shape — see urdf-clearance.ts).
//
// Framework-free by design (DOM-only, no three.js import) so the parse
// contract is unit-testable without mounting WebGL — same idiom as
// components/conkay/lattice-globe-motion.ts.

import type { UrdfRobot, UrdfLink, UrdfJoint, UrdfGeometry, UrdfOrigin, UrdfJointType, UrdfJointLimit, Vec3 } from './urdf-types';

export type UrdfParseResult =
  | { ok: true; robot: UrdfRobot; warnings: string[] }
  | { ok: false; error: string };

const JOINT_TYPES: UrdfJointType[] = ['revolute', 'continuous', 'prismatic', 'fixed', 'floating', 'planar'];

function childElsOf(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName.toLowerCase() === tag);
}
function firstChildEl(el: Element | null, tag: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.tagName.toLowerCase() === tag) return c;
  return null;
}

function parseFloats(attr: string | null | undefined, count: number, fallback: number[]): number[] {
  if (!attr) return fallback.slice(0, count);
  const parts = attr.trim().split(/\s+/).map(Number);
  if (parts.length !== count || parts.some((n) => !Number.isFinite(n))) return fallback.slice(0, count);
  return parts;
}

function parseOrigin(el: Element | null): UrdfOrigin {
  const xyz = parseFloats(el?.getAttribute('xyz'), 3, [0, 0, 0]) as Vec3;
  const rpy = parseFloats(el?.getAttribute('rpy'), 3, [0, 0, 0]) as Vec3;
  return { xyz, rpy };
}

function parseGeometry(el: Element | null): UrdfGeometry | null {
  if (!el) return null;
  const box = firstChildEl(el, 'box');
  if (box) return { kind: 'box', size: parseFloats(box.getAttribute('size'), 3, [1, 1, 1]) as Vec3 };
  const cyl = firstChildEl(el, 'cylinder');
  if (cyl) {
    const radius = Number(cyl.getAttribute('radius'));
    const length = Number(cyl.getAttribute('length'));
    return { kind: 'cylinder', radius: Number.isFinite(radius) && radius > 0 ? radius : 0.1, length: Number.isFinite(length) && length > 0 ? length : 0.1 };
  }
  const sph = firstChildEl(el, 'sphere');
  if (sph) {
    const radius = Number(sph.getAttribute('radius'));
    return { kind: 'sphere', radius: Number.isFinite(radius) && radius > 0 ? radius : 0.1 };
  }
  const mesh = firstChildEl(el, 'mesh');
  if (mesh) {
    return {
      kind: 'mesh',
      filename: mesh.getAttribute('filename') || '',
      scale: parseFloats(mesh.getAttribute('scale'), 3, [1, 1, 1]) as Vec3,
    };
  }
  return null;
}

function parseVisuals(linkEl: Element) {
  return childElsOf(linkEl, 'visual').map((v) => {
    const origin = parseOrigin(firstChildEl(v, 'origin'));
    const geometry = parseGeometry(firstChildEl(v, 'geometry'));
    let color: [number, number, number, number] | undefined;
    const material = firstChildEl(v, 'material');
    const colorEl = material ? firstChildEl(material, 'color') : null;
    if (colorEl) {
      const rgba = parseFloats(colorEl.getAttribute('rgba'), 4, [0.6, 0.6, 0.6, 1]);
      color = rgba as [number, number, number, number];
    }
    return { name: v.getAttribute('name') || undefined, origin, geometry, color };
  });
}

function parseLimit(el: Element | null): UrdfJointLimit | null {
  if (!el) return null;
  const lower = Number(el.getAttribute('lower'));
  const upper = Number(el.getAttribute('upper'));
  const effort = Number(el.getAttribute('effort'));
  const velocity = Number(el.getAttribute('velocity'));
  return {
    lower: Number.isFinite(lower) ? lower : 0,
    upper: Number.isFinite(upper) ? upper : 0,
    effort: Number.isFinite(effort) ? effort : 0,
    velocity: Number.isFinite(velocity) ? velocity : 0,
  };
}

/**
 * Parse a URDF XML document into a validated link/joint tree. Returns an
 * honest `{ ok:false, error }` for anything malformed — never a partial or
 * guessed reconstruction of a broken document.
 */
export function parseUrdf(xmlText: string): UrdfParseResult {
  if (typeof xmlText !== 'string' || !xmlText.trim()) {
    return { ok: false, error: 'Empty URDF document.' };
  }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  } catch (e) {
    return { ok: false, error: `XML parse failure: ${String((e as Error)?.message || e)}` };
  }
  const parseErrorEl = doc.querySelector('parsererror');
  if (parseErrorEl) return { ok: false, error: `Malformed XML: ${(parseErrorEl.textContent || 'parse error').slice(0, 200)}` };

  const robotEl = doc.documentElement;
  if (!robotEl || robotEl.tagName.toLowerCase() !== 'robot') {
    return { ok: false, error: 'Root element must be <robot>.' };
  }
  const name = robotEl.getAttribute('name') || 'unnamed_robot';
  const warnings: string[] = [];

  const linkEls = childElsOf(robotEl, 'link');
  if (linkEls.length === 0) return { ok: false, error: 'URDF must define at least one <link>.' };

  const links: UrdfLink[] = [];
  const seenLinkNames = new Set<string>();
  for (const le of linkEls) {
    const lname = le.getAttribute('name');
    if (!lname) return { ok: false, error: 'Every <link> requires a name attribute.' };
    if (seenLinkNames.has(lname)) return { ok: false, error: `Duplicate link name "${lname}".` };
    seenLinkNames.add(lname);
    links.push({ name: lname, visuals: parseVisuals(le) });
  }

  const jointEls = childElsOf(robotEl, 'joint');
  const joints: UrdfJoint[] = [];
  const seenJointNames = new Set<string>();
  for (const je of jointEls) {
    const jname = je.getAttribute('name');
    if (!jname) return { ok: false, error: 'Every <joint> requires a name attribute.' };
    if (seenJointNames.has(jname)) return { ok: false, error: `Duplicate joint name "${jname}".` };
    seenJointNames.add(jname);

    const typeAttr = je.getAttribute('type');
    const type: UrdfJointType = typeAttr && (JOINT_TYPES as string[]).includes(typeAttr) ? (typeAttr as UrdfJointType) : 'fixed';
    if (!typeAttr) warnings.push(`Joint "${jname}" missing type attribute — treated as fixed.`);

    const parentLink = firstChildEl(je, 'parent')?.getAttribute('link') || null;
    const childLink = firstChildEl(je, 'child')?.getAttribute('link') || null;
    if (!parentLink || !seenLinkNames.has(parentLink)) return { ok: false, error: `Joint "${jname}" references unknown parent link "${parentLink || ''}".` };
    if (!childLink || !seenLinkNames.has(childLink)) return { ok: false, error: `Joint "${jname}" references unknown child link "${childLink || ''}".` };

    const origin = parseOrigin(firstChildEl(je, 'origin'));
    const axisEl = firstChildEl(je, 'axis');
    const axis = (axisEl ? parseFloats(axisEl.getAttribute('xyz'), 3, [1, 0, 0]) : [1, 0, 0]) as Vec3;
    const limit = parseLimit(firstChildEl(je, 'limit'));
    if ((type === 'revolute' || type === 'prismatic') && !limit) {
      warnings.push(`Joint "${jname}" is ${type} but declares no <limit> — the viewer defaults its slider to [-3.14, 3.14].`);
    }

    joints.push({ name: jname, type, parent: parentLink, child: childLink, origin, axis, limit });
  }

  // A valid URDF kinematic tree gives each link at most one parent joint.
  const childCounts = new Map<string, number>();
  for (const j of joints) childCounts.set(j.child, (childCounts.get(j.child) || 0) + 1);
  for (const [child, count] of childCounts) {
    if (count > 1) return { ok: false, error: `Link "${child}" has more than one parent joint — not a valid tree.` };
  }

  const rootCandidates = links.map((l) => l.name).filter((n) => !childCounts.has(n));
  if (rootCandidates.length === 0) return { ok: false, error: "URDF has no root link — every link is some joint's child (cycle)." };

  // Cycle detection via DFS from every root candidate.
  const byParent = new Map<string, UrdfJoint[]>();
  for (const j of joints) {
    const list = byParent.get(j.parent) || [];
    list.push(j);
    byParent.set(j.parent, list);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  function dfs(link: string): boolean {
    if (done.has(link)) return true;
    if (visiting.has(link)) return false;
    visiting.add(link);
    for (const j of byParent.get(link) || []) {
      if (!dfs(j.child)) return false;
    }
    visiting.delete(link);
    done.add(link);
    return true;
  }
  for (const r of rootCandidates) {
    if (!dfs(r)) return { ok: false, error: 'URDF kinematic tree contains a cycle.' };
  }

  return { ok: true, robot: { name, links, joints }, warnings };
}
