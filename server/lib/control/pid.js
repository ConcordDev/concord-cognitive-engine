// server/lib/control/pid.js
//
// Engine N5 — control theory = keeping a system inside its viability set by
// FEEDBACK. A PID controller drives a measured value toward a setpoint by
// correcting on the error (P), its accumulation (I), and its rate of change
// (D) — the math for actuated systems: vehicle speed/steering, factory belt
// rates, mount gait, any "hold this target" loop. Pure + a thin stateful
// wrapper. Anti-windup clamp on the integral term.

/**
 * One pure PID step. error = setpoint − measured. Returns the control output
 * plus the carried state (integral, prevError) to thread into the next step.
 *   output = kp·e + ki·∫e + kd·(de/dt)
 */
export function pidStep({ kp = 0, ki = 0, kd = 0 } = {}, setpoint, measured, prior = {}, dt = 1, { iMin = -Infinity, iMax = Infinity } = {}) {
  const error = Number(setpoint) - Number(measured);
  const step = Math.max(1e-9, Number(dt) || 1);
  let integral = (Number(prior.integral) || 0) + error * step;
  integral = Math.max(iMin, Math.min(iMax, integral)); // anti-windup
  const prevError = Number(prior.prevError) || 0;
  const derivative = (error - prevError) / step;
  const output = kp * error + ki * integral + kd * derivative;
  return { output, integral, prevError: error, error };
}

/** Stateful controller for the actuated-system call sites (vehicle/mount/factory). */
export function createPIDController(gains, setpoint, opts = {}) {
  let state = { integral: 0, prevError: 0 };
  let target = Number(setpoint) || 0;
  return {
    update(measured, dt = 1) {
      const r = pidStep(gains, target, measured, state, dt, opts);
      state = { integral: r.integral, prevError: r.prevError };
      return r.output;
    },
    setTarget(s) { target = Number(s) || 0; },
    reset() { state = { integral: 0, prevError: 0 }; },
    get target() { return target; },
  };
}

/**
 * Simulate a controller driving a plant toward a setpoint. Default plant is a
 * first-order integrator (x += output·dt), with optional damping. Returns the
 * trajectory + whether it settled within `tol` of the setpoint. Used to verify
 * tuning + as the "does this control loop converge" stability check.
 */
export function simulateToSetpoint(gains, setpoint, { steps = 100, dt = 0.1, x0 = 0, plant, tol = 0.05 } = {}) {
  const ctrl = createPIDController(gains, setpoint, { iMin: -1e6, iMax: 1e6 });
  let x = Number(x0) || 0;
  const trajectory = [x];
  const advance = typeof plant === "function" ? plant : (xPrev, u, d) => xPrev + u * d;
  for (let i = 0; i < steps; i++) {
    const u = ctrl.update(x, dt);
    x = advance(x, u, dt);
    trajectory.push(x);
  }
  const finalError = Math.abs(setpoint - x);
  return { trajectory, finalValue: x, finalError, settled: finalError <= tol };
}
