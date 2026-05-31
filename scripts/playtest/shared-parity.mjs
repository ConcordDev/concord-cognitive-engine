// scripts/playtest/shared-parity.mjs
//
// Axis A — shared-state parity (multiplayer is the actual product). Single-camera
// parity asks "will A see what A did"; this asks "when A acts, does B see it?".
// Pure diff over two clients' world views + a driver-injectable runner (two
// agent-players, one acts, one observes). The live adapter supplies real drivers.

/**
 * Diff two players' views of the same world after an action. Returns the
 * divergences: things present for the actor but missing/different for the observer.
 * @param {object[]} actorView  entities the acting client sees [{id,x,z,kind,...}]
 * @param {object[]} observerView entities the observing client sees
 * @param {object} opts { keys?: string[] fields compared, epsilon?: position tol }
 */
export function diffViews(actorView = [], observerView = [], opts = {}) {
  const keys = opts.keys || ["kind"];
  const eps = opts.epsilon ?? 0.5;
  const obs = new Map(observerView.map((e) => [e.id, e]));
  const divergences = [];
  for (const a of actorView) {
    const b = obs.get(a.id);
    if (!b) { divergences.push({ id: a.id, reason: "missing_for_observer" }); continue; }
    if (Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.z ?? 0) - (b.z ?? 0)) > eps) {
      divergences.push({ id: a.id, reason: "position_mismatch", a: [a.x, a.z], b: [b.x, b.z] });
    }
    for (const k of keys) {
      if (a[k] !== undefined && a[k] !== b[k]) divergences.push({ id: a.id, reason: `field:${k}`, a: a[k], b: b[k] });
    }
  }
  return { parity: divergences.length === 0, divergences };
}

/** Are both views consistent? (the gate predicate) */
export function viewsAgree(actorView, observerView, opts) {
  return diffViews(actorView, observerView, opts).parity;
}

/**
 * Live runner: A performs `act`, both snapshot, diff. driverA/driverB are the
 * two-client adapters. Returns { ok, divergences }.
 */
export async function runSharedParity({ driverA, driverB, act, settleTicks = 2 } = {}) {
  if (!driverA || !driverB || typeof act !== "function") return { ok: false, reason: "need_two_drivers_and_act" };
  await act(driverA);
  if (driverA.tick) await driverA.tick(settleTicks);
  const aView = (await driverA.snapshot())?.npcs || [];
  const bView = (await driverB.snapshot())?.npcs || [];
  const { parity, divergences } = diffViews(aView, bView);
  return { ok: parity, divergences };
}
