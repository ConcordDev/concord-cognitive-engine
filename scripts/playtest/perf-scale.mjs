// scripts/playtest/perf-scale.mjs
//
// Axis E — performance at crowd scale. "Render everything" + a busy market + an
// uprising crowd + AI citizens hit one frame budget. The uprising you dreamed of
// must not melt the client. Pure budget assertions + a load runner.

const TARGET_FPS = 60;
const FRAME_BUDGET_MS = 1000 / TARGET_FPS; // 16.67ms
const TICK_BUDGET_MS = 15000;              // the 15s heartbeat interval

/**
 * Does a measured sample hold the budget at the given scale?
 * @param {object} s { entities, players, fps, tickMs }
 */
export function frameBudgetOk(s = {}) {
  const reasons = [];
  if (Number(s.fps) < TARGET_FPS - 5) reasons.push({ kind: "fps_below_target", fps: s.fps, target: TARGET_FPS });
  if (Number(s.tickMs) > TICK_BUDGET_MS) reasons.push({ kind: "tick_overrun", tickMs: s.tickMs, budget: TICK_BUDGET_MS });
  return { ok: reasons.length === 0, reasons, frameBudgetMs: FRAME_BUDGET_MS };
}

/** The headline gate: 200 entities + 10 players → 60fps + tick budget intact. */
export function crowdScaleGate(sample) {
  const scaleOk = (sample.entities ?? 0) >= 200 && (sample.players ?? 0) >= 10;
  const budget = frameBudgetOk(sample);
  return { ok: budget.ok, atScale: scaleOk, ...budget };
}

/**
 * Live runner: spawn `entities` + `players`, let it settle, measure fps + tick
 * duration via the driver's perf probe. `measure(driver)` returns {fps, tickMs}.
 */
export async function runPerfScale({ driver, entities = 200, players = 10, spawn, measure } = {}) {
  if (!driver || typeof measure !== "function") return { ok: false, reason: "need_driver_and_measure" };
  if (typeof spawn === "function") await spawn(driver, { entities, players });
  if (driver.tick) await driver.tick(2);
  const sample = { entities, players, ...(await measure(driver)) };
  return crowdScaleGate(sample);
}

export { TARGET_FPS, FRAME_BUDGET_MS, TICK_BUDGET_MS };
