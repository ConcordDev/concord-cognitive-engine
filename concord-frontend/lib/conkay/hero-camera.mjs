// 3/4 studio camera. Vehicle metres in, three.js position out.
// The scene recentres the car on x. Camera space matches three.js lookAt:
// local +Z points from the eye back toward the camera, so a point in front
// has negative view Z.

const FOV = 28;

/** @typedef {[number, number, number]} Vec3 */

/** @param {Vec3} v @returns {Vec3} */
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
/** @param {Vec3} a @param {Vec3} b */
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
/** @param {Vec3} a @param {number} s @returns {Vec3} */
function mul(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/**
 * Front-left hero view that keeps every corner of the body inside the frame.
 * `aspect` is canvas width / height. `margin` is the NDC limit (1 is the edge).
 * @param {{ min: number[], max: number[] }} bounds
 * @param {number} [aspect]
 * @param {number} [margin]
 * @returns {{ position: Vec3, target: Vec3, fov: number }}
 */
export function studioHeroCamera(bounds, aspect = 1.6, margin = 0.82) {
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const minX = bounds.min[0] - cx;
  const maxX = bounds.max[0] - cx;
  const minY = Math.min(0, bounds.min[2]);
  const maxY = bounds.max[2];
  // three z = -vehicle y
  const minZ = -bounds.max[1];
  const maxZ = -bounds.min[1];
  const corners = [];
  for (const x of [minX, maxX]) {
    for (const y of [minY, maxY]) {
      for (const z of [minZ, maxZ]) corners.push([x, y, z]);
    }
  }
  const target = [0, minY + (maxY - minY) * 0.42, 0];
  // In front of the nose (-x), a little above the belt, on the left side (+z).
  const dir = normalize([-0.92, 0.38, 1.12]);
  const vFov = (FOV * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.6, aspect));
  const fits = (dist) => {
    const cam = add(target, mul(dir, dist));
    const zAxis = normalize(sub(cam, target));
    const xAxis = normalize(cross([0, 1, 0], zAxis));
    const yAxis = cross(zAxis, xAxis);
    for (const p of corners) {
      const d = sub(p, cam);
      const vx = dot(d, xAxis);
      const vy = dot(d, yAxis);
      const vz = dot(d, zAxis);
      if (vz >= -0.05) return false;
      const ndcX = vx / (-vz * Math.tan(hFov / 2));
      const ndcY = vy / (-vz * Math.tan(vFov / 2));
      if (Math.abs(ndcX) > margin || Math.abs(ndcY) > margin) return false;
    }
    return true;
  };
  let lo = 2;
  let hi = 48;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return { position: add(target, mul(dir, hi)), target, fov: FOV };
}
