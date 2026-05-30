// scripts/playtest/liveness.mjs
//
// Instrument 2 — the agent playtest's beating heart: LIVENESS predicates + a
// journey runner that judges OBSERVABLE OUTCOMES, not return codes. An e2e
// asserts a known happy path; a playtest plays the world and NOTICES when
// something's dead/frozen/silent/invisible. The generalized rule: a
// player-perceivable thing must CHANGE within a time budget.
//
// These two assertions are the ones that caught the real bugs:
//   - frozen priest → "after N ticks, ≥30% of NPCs changed position AND ≥1
//     ambient event fired."  (npcsMoved + eventFired)
//   - hydrology     → "seed water uphill of a dug pit, tick, assert the pit's
//     water_height > 0."     (stateChanged)
//
// Pure + driver-injectable so it unit-tests headlessly with a mock world; the
// live-server adapter (agent-playtest.mjs) supplies a real HTTP/socket driver.

// ── Liveness predicates (pure) ───────────────────────────────────────────────

/** Fraction of tracked entities whose (x,z) moved more than `epsilon`. */
export function movedFraction(before, after, epsilon = 0.01) {
  if (!before?.length) return 0;
  const byId = new Map(after.map((e) => [e.id, e]));
  let moved = 0;
  for (const b of before) {
    const a = byId.get(b.id);
    if (!a) continue;
    if (Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.z ?? 0) - (b.z ?? 0)) > epsilon) moved++;
  }
  return moved / before.length;
}

/** ≥ `fraction` of NPCs moved — the frozen-priest detector. */
export function npcsMoved(before, after, fraction = 0.3) {
  return movedFraction(before, after) >= fraction;
}

/** An event with `name` (prefix-aware) fired in the collected stream. */
export function eventFired(events, name) {
  return (events || []).some((e) => e === name || e?.name === name || String(e?.name || e).startsWith(name));
}

/** A nested value at dot-path changed between two snapshots. */
function at(obj, path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
export function stateChanged(before, after, path) {
  return JSON.stringify(at(before, path)) !== JSON.stringify(at(after, path));
}

/** A value at dot-path satisfies a comparison (e.g. hydrology pit > 0). */
export function valueWhere(snapshot, path, cmp) {
  return !!cmp(at(snapshot, path));
}

/** The world handed the player a usable thread (the legibility test). */
export function threadSurfaced(payload) {
  if (!payload) return false;
  const hook = payload.hook ?? payload.thread ?? payload.quest ?? payload.lead ?? null;
  return !!hook && (hook.actionable !== false);
}

// ── Journey runner (driver-injectable) ───────────────────────────────────────
//
// A journey is { id, label, steps: [{ name, run(ctx)→obs, live: [assertion] }] }.
// Each assertion is { name, check(obs, ctx)→bool, budget? }. `run` performs the
// step against the injected driver and returns an observation bag. The runner
// records pass/fail per assertion + the no-silent-fallback log the driver
// exposes, and never throws (a dead step is a finding, not a crash).

export async function runJourney(journey, driver) {
  const results = [];
  const fallbackLog = [];
  let alive = true;
  for (const step of journey.steps) {
    let obs = {};
    let error = null;
    try { obs = (await step.run({ driver })) || {}; }
    catch (e) { error = e?.message || String(e); }
    // Collect any silent-fallback signals the driver saw during the step.
    if (driver.drainFallbacks) fallbackLog.push(...driver.drainFallbacks());
    const checks = (step.live || []).map((a) => {
      let ok = false; let detail = null;
      try { ok = !error && !!a.check(obs, { driver }); }
      catch (e) { detail = e?.message || String(e); }
      if (!ok) alive = false;
      return { assertion: a.name, ok, detail };
    });
    results.push({ step: step.name, error, checks });
  }
  return {
    journey: journey.id,
    label: journey.label,
    alive,
    steps: results,
    silentFallbacks: fallbackLog,
    summary: `${results.flatMap((r) => r.checks).filter((c) => c.ok).length}/` +
      `${results.flatMap((r) => r.checks).length} liveness checks` +
      (fallbackLog.length ? `, ${fallbackLog.length} silent fallbacks` : ""),
  };
}

/** Run several journeys, return a rollup (the playtest report). */
export async function runJourneys(journeys, driverFactory) {
  const out = [];
  for (const j of journeys) out.push(await runJourney(j, await driverFactory(j)));
  const alive = out.filter((r) => r.alive).length;
  return { alive, total: out.length, journeys: out };
}
