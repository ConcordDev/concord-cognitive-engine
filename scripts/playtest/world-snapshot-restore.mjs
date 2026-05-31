// scripts/playtest/world-snapshot-restore.mjs
//
// Axis D — persistence & irreversibility (data-loss is the one unforgivable bug).
// Players own creations; royalties make that ownership real value. A bad
// migration or a stuck emergent thread can permanently destroy player value.
// Pure preservation diff + a snapshot/restore runner.

/**
 * Assert every player creation in `before` survives into `after`. Returns the
 * losses (creations present before but missing/mutated after). Identity is `id`;
 * `ownerKey`/`contentKeys` guard against silent ownership/content corruption.
 */
export function diffPreservation(before = [], after = [], opts = {}) {
  const ownerKey = opts.ownerKey || "creator_id";
  const contentKeys = opts.contentKeys || [];
  const afterById = new Map(after.map((d) => [d.id, d]));
  const losses = [];
  for (const b of before) {
    const a = afterById.get(b.id);
    if (!a) { losses.push({ id: b.id, reason: "lost" }); continue; }
    if (b[ownerKey] !== undefined && a[ownerKey] !== b[ownerKey]) {
      losses.push({ id: b.id, reason: "owner_changed", before: b[ownerKey], after: a[ownerKey] });
    }
    for (const k of contentKeys) {
      if (b[k] !== undefined && a[k] !== b[k]) losses.push({ id: b.id, reason: `content:${k}` });
    }
  }
  return { preserved: losses.length === 0, losses };
}

/** The gate predicate — a migration / restore preserved every creation. */
export function creationsPreserved(before, after, opts) {
  return diffPreservation(before, after, opts).preserved;
}

/**
 * Live runner: snapshot creations, run `mutate` (a migration / restore / a
 * suspected-corrupting op), snapshot again, diff. `listCreations(driver)` returns
 * the player-owned creations (DTUs, claims, …).
 */
export async function runSnapshotRestore({ driver, listCreations, mutate, opts } = {}) {
  if (!driver || typeof listCreations !== "function" || typeof mutate !== "function") {
    return { ok: false, reason: "need_driver_list_mutate" };
  }
  const before = await listCreations(driver);
  await mutate(driver);
  const after = await listCreations(driver);
  const { preserved, losses } = diffPreservation(before, after, opts);
  return { ok: preserved, losses, beforeCount: before.length, afterCount: after.length };
}
