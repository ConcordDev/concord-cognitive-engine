// scripts/playtest/clueless-newbie.mjs
//
// Axis C — the naive-newbie blind spot. An LLM playtester is too competent to
// ever be confused, so it structurally cannot catch "a brand-new human would
// have no idea what to do and would quit." This models a clueless first-timer:
// it logs every moment of "I don't know what to do" and rage-quits when lost
// past a threshold. (Still cannot REPLACE the human in the chair — it widens
// coverage toward the friction a newcomer feels.)

/**
 * A confusion tracker. The agent reports each step's outcome; a step that
 * produced no legible affordance / no perceivable change is a confusion point.
 */
export function createNewbieTracker({ rageQuitAt = 3 } = {}) {
  const confusions = [];
  let consecutive = 0;
  let quit = false;
  return {
    /** Record a step. `understood` = did the newbie know what to do + see a result? */
    step(label, understood, note = "") {
      if (understood) { consecutive = 0; return; }
      confusions.push({ label, note });
      consecutive++;
      if (consecutive >= rageQuitAt) quit = true;
    },
    get rageQuit() { return quit; },
    get confusionCount() { return confusions.length; },
    report() { return { rageQuit: quit, confusionCount: confusions.length, confusions }; },
  };
}

/**
 * Heuristic: did a step give the newbie a legible affordance? A result with an
 * actionable next step / a perceivable change is "understood"; a bare ok / an
 * error / an empty list is confusing.
 */
export function stepWasLegible(result) {
  if (!result || result.ok === false) return false;
  if (result.error) return false;
  // A result that hands the player a thread / next action / visible change.
  if (result.next || result.hint || result.prompt || result.thread) return true;
  if (Array.isArray(result.options) && result.options.length > 0) return true;
  if (Array.isArray(result.items) || Array.isArray(result.events)) {
    return (result.items?.length ?? result.events?.length ?? 0) > 0;
  }
  // A bare {ok:true} with nothing to do next reads as a dead end to a newcomer.
  return false;
}

/**
 * Live runner: walk an onboarding script of steps; each step is { label, run }
 * where run(driver)→result. Returns the confusion report.
 */
export async function runCluelessNewbie({ driver, steps = [], rageQuitAt = 3 } = {}) {
  if (!driver) return { ok: false, reason: "need_driver" };
  const tracker = createNewbieTracker({ rageQuitAt });
  for (const s of steps) {
    if (tracker.rageQuit) break;
    let result = null;
    try { result = await s.run(driver); } catch (e) { result = { ok: false, error: e?.message }; }
    tracker.step(s.label, stepWasLegible(result), s.note);
  }
  const rep = tracker.report();
  return { ok: !rep.rageQuit, ...rep };
}
