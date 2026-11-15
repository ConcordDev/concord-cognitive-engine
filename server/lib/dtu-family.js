// server/lib/dtu-family.js
//
// The DTU record family: one lens artifact and every lens_exhaust DTU minted
// for it. _lensEmitDTU (server.js) creates the family — each lens
// create/update/delete of an artifact mints a 'Lens:<domain> <action> <type>'
// DTU and links it both ways (artifact._dtuIds[] and dtu.machine.artifactId).
//
// The founder's canonical archive/delete verb (CB-0554 ruling (1)) deletes the
// family whole: removing the record from one store while its exhausts stay in
// the owner's vault left dead records naming a piece that no longer exists
// (FIX-crafting-002), and deleting a capture's create exhaust left its sibling
// lifecycle exhausts orphaned (FIX-ux-suite-015 family). This module is the
// one place that knows how to collect the family; both canonical delete paths
// (dtu.delete's artifact cascade and lens.delete) sweep through it, and the
// dtu.archive macro delegates to those paths. No per-lens variants.
//
// Pure over the stores so it can be unit-tested without booting the server:
// callers pass a callback for the per-DTU side effects that live in server.js
// (embedding index, search index, write clock).

/**
 * Every exhaust DTU id belonging to an artifact: the maintained link list
 * (artifact._dtuIds) unioned with a scan of the DTU store for exhausts whose
 * machine block names the artifact. The union covers artifacts minted before
 * linkArtifactDTU existed, whose link list may be incomplete while their
 * exhausts still carry machine.artifactId.
 *
 * @param {object} STATE  store holder with .dtus (Map-like)
 * @param {object} artifact  the lens artifact (needs .id, optional ._dtuIds)
 * @returns {string[]} DTU ids in the artifact's exhaust family
 */
export function collectArtifactExhaustIds(STATE, artifact) {
  const ids = new Set();
  if (Array.isArray(artifact?._dtuIds)) {
    for (const id of artifact._dtuIds) {
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  const artifactId = artifact?.id;
  if (artifactId && STATE?.dtus && typeof STATE.dtus.values === "function") {
    for (const dtu of STATE.dtus.values()) {
      if (dtu?.machine?.kind === "lens_exhaust" && dtu.machine?.artifactId === artifactId && typeof dtu.id === "string") {
        ids.add(dtu.id);
      }
    }
  }
  return [...ids];
}

/**
 * Remove an artifact's whole exhaust family from STATE.dtus.
 *
 * Callers invoke this only once the artifact itself is being removed (or has
 * been removed) under their own owner gate — the sweep inherits that
 * authorization; it performs no gate of its own. Exhausts of a LIVING
 * artifact are lifecycle bookkeeping and are never swept.
 *
 * @param {object} STATE  store holder with .dtus (Map-like)
 * @param {object} artifact  the lens artifact whose family is swept
 * @param {object} [opts]
 * @param {Set<string>} [opts.keep]  DTU ids to leave in place
 * @param {(id: string) => void} [opts.onDtuRemoved]  per-removal side effects
 * @returns {string[]} the DTU ids actually removed
 */
export function sweepArtifactExhausts(STATE, artifact, opts = {}) {
  const removed = [];
  if (!STATE?.dtus || typeof STATE.dtus.delete !== "function" || !artifact?.id) return removed;
  for (const id of collectArtifactExhaustIds(STATE, artifact)) {
    if (opts.keep && opts.keep.has(id)) continue;
    if (STATE.dtus.delete(id)) {
      removed.push(id);
      try { opts.onDtuRemoved?.(id); } catch { /* side effects never block the sweep */ }
    }
  }
  return removed;
}

export default { collectArtifactExhaustIds, sweepArtifactExhausts };
