// server/lib/robotics/actuator-adapter.js
//
// Robotics actuator adapter (#27) — the boundary between Concord's real computed
// motion plans and a PHYSICAL robot. This environment has no robot attached, so
// the default adapter HONESTLY reports it cannot actuate — it never pretends a
// move happened. A real deployment registers a driver (ROS bridge, serial, etc.)
// via setActuator(); from then on actuate() forwards the real command and returns
// the driver's real result.

let _driver = null;

/** Register a real actuator driver: async ({ robotId, command }) => { ok, ... }. */
export function setActuator(driver) {
  _driver = (typeof driver === "function") ? driver : null;
  return { ok: true, registered: !!_driver };
}

/** Is a real actuator attached? */
export function hasActuator() { return !!_driver; }

/**
 * Send a motion command. With no driver attached this returns an honest
 * "unavailable" — NOT a faked success. The caller can still persist the planned
 * command (the plan is real); only the physical execution is gated on hardware.
 */
export async function actuate({ robotId = null, command = null } = {}) {
  if (!_driver) {
    return { ok: false, reason: "no_actuator", note: "no physical robot attached in this environment; register a driver via setActuator()" };
  }
  try {
    const r = await _driver({ robotId, command });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, reason: "actuator_error", error: String(e?.message || e) };
  }
}

export default { setActuator, hasActuator, actuate };
