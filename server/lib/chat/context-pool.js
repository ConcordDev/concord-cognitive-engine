// Chat's DTU candidate pool. It used to fall back to every hot DTU when the
// user had no local universe, so internal and other users' private DTUs could
// reach the LLM as context. Fail closed: without a universe use only what the
// viewer can see, and filter every source through the same predicate.

/**
 * @param {object} p
 * @param {object[]|null} p.universe  the user's local universe, or null
 * @param {() => object[]} p.visible  viewer-visible DTUs (userVisibleDTUs)
 * @param {(d: object) => boolean} p.mayUse  per-DTU visibility check
 * @returns {object[]}
 */
export function chatContextPool({ universe = null, visible, mayUse }) {
  if (typeof mayUse !== "function") return [];
  const base = Array.isArray(universe) ? universe : (typeof visible === "function" ? (visible() || []) : []);
  return base.filter((d) => d && mayUse(d));
}

/**
 * Viewer may use d as context: their own DTU, or one that is neither hidden
 * (internal / system) nor private to someone else.
 */
export function makeChatMayUse({ viewerId = null, isHidden, isPrivateFrom }) {
  return (d) => {
    if (!d) return false;
    const owner = d.ownerId || d.author || d.userId || d.createdBy || null;
    if (viewerId && owner && owner === viewerId) return true;
    if (typeof isHidden === "function" && isHidden(d)) return false;
    if (typeof isPrivateFrom === "function" && isPrivateFrom(d, viewerId)) return false;
    return true;
  };
}
