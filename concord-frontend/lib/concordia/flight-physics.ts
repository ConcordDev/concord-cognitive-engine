// concord-frontend/lib/concordia/flight-physics.ts
//
// Concordia Phase 7 — banking aerodynamics + stall + wind / thermal
// integration.
//
// Pure / stateless integrator the avatar tick calls each frame with
// the current `FlightState` + dt + wind sample. Returns the next
// FlightState. No global state; world-lens hosts compose this with
// the kinematic capsule on top of the existing setGlide path.
//
// Banking model:
//   - roll ∈ [-PI/2, PI/2]
//   - yaw_rate = sin(roll) * BANK_TO_YAW
//   - airspeed declines linearly while airborne; stall when
//     airspeed < STALL_AIRSPEED and angle_of_attack > AOA_STALL
//   - stall recovery requires nose-down (pitch < 0) for STALL_RECOVERY_MS
//
// Wind / thermals (input from server lib/embodied/wind-currents):
//   - wind.x/z directly add to horizontal velocity (drift)
//   - lift adds to vertical velocity (countering gravity in hot cells)

export interface FlightInputs {
  /** Roll input from controller in [-1, 1] (negative = left bank). */
  roll: number;
  /** Pitch input from controller in [-1, 1] (negative = nose down). */
  pitch: number;
  /** Whether the flight mode is active. */
  active: boolean;
}

export interface WindSample {
  wind: { x: number; y: number; z: number };
  lift: number;
}

export interface FlightState {
  airspeed: number;        // m/s scalar along the heading vector
  heading: number;         // yaw, radians
  rollRad: number;
  pitchRad: number;
  vy: number;              // vertical velocity m/s
  stalled: boolean;
  stallTimerMs: number;    // accumulated nose-down recovery time
}

const BANK_TO_YAW         = 1.4;      // rad-yaw per unit-roll per second
const AIRSPEED_BLEED      = 0.4;      // m/s lost per second to drag
const AIRSPEED_GAIN_DIVE  = 6.0;      // m/s gained per second in dive (pitch<-0.5)
const STALL_AIRSPEED      = 4.0;      // m/s below this AND high AoA → stall
const AOA_STALL_RAD       = 0.31;     // ~18°
const STALL_RECOVERY_MS   = 1500;     // ms of nose-down to recover
const ROLL_SLEW_RAD_S     = 2.4;      // max roll rate
const PITCH_SLEW_RAD_S    = 2.0;
const GRAVITY_FALLBACK    = 9.81;
const GLIDE_DESCENT_CAP   = -1.5;     // m/s; can be reversed by lift

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function newFlightState(): FlightState {
  return {
    airspeed: 10,
    heading: 0,
    rollRad: 0,
    pitchRad: 0,
    vy: GLIDE_DESCENT_CAP,
    stalled: false,
    stallTimerMs: 0,
  };
}

/**
 * Advance flight by `dtSeconds`, given controller inputs + a wind
 * sample from the server's wind-currents lib. Caller integrates the
 * returned heading + airspeed into the avatar's world position
 * separately (this function is purely the aero update).
 */
export function stepFlight(
  state: FlightState,
  inputs: FlightInputs,
  wind: WindSample,
  dtSeconds: number,
): FlightState {
  if (!inputs.active) return { ...state, vy: clamp(state.vy, GLIDE_DESCENT_CAP, 0) };

  const dt = Math.max(0.0001, Math.min(0.25, dtSeconds));
  // Slew roll/pitch toward input targets.
  const rollTarget = clamp(inputs.roll, -1, 1) * Math.PI / 2;
  const pitchTarget = clamp(inputs.pitch, -1, 1) * Math.PI / 3;
  const rollRad = approach(state.rollRad, rollTarget, ROLL_SLEW_RAD_S * dt);
  const pitchRad = approach(state.pitchRad, pitchTarget, PITCH_SLEW_RAD_S * dt);

  // Heading drift from bank.
  const yawRate = Math.sin(rollRad) * BANK_TO_YAW;
  const heading = state.heading + yawRate * dt;

  // Airspeed: bleed in level / climb, gain in dive.
  const diveFactor = pitchRad < -0.5 ? AIRSPEED_GAIN_DIVE * (Math.abs(pitchRad) - 0.5) : 0;
  let airspeed = Math.max(0, state.airspeed - AIRSPEED_BLEED * dt + diveFactor * dt);

  // Stall logic:
  // - High AoA + low airspeed → enter stall.
  // - In stall: drop fast, require nose-down for STALL_RECOVERY_MS.
  let stalled = state.stalled;
  let stallTimerMs = state.stallTimerMs;
  const aoa = Math.max(0, pitchRad); // positive AoA = nose up
  if (!stalled) {
    if (aoa > AOA_STALL_RAD && airspeed < STALL_AIRSPEED) {
      stalled = true;
      stallTimerMs = 0;
    }
  } else {
    if (pitchRad < -0.05) {
      stallTimerMs += dt * 1000;
      if (stallTimerMs >= STALL_RECOVERY_MS) {
        stalled = false;
        stallTimerMs = 0;
      }
    } else {
      stallTimerMs = 0;
    }
  }

  // Vertical velocity. Glide descent floor, modified by lift, plus
  // stall drop.
  const vy = clamp(state.vy + (wind?.lift ?? 0) * dt - (stalled ? GRAVITY_FALLBACK * 0.5 * dt : 0),
                  stalled ? -GRAVITY_FALLBACK : GLIDE_DESCENT_CAP, // floor
                  4.0); // cap on climb

  // Wind drift contribution (horizontal — caller blends into world pos).
  // Nothing to write here; we just keep airspeed bounded.
  airspeed = Math.min(45, airspeed);

  return { airspeed, heading, rollRad, pitchRad, vy, stalled, stallTimerMs };
}

function approach(current: number, target: number, maxStep: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

export const FLIGHT_CONSTANTS = Object.freeze({
  BANK_TO_YAW, AIRSPEED_BLEED, AIRSPEED_GAIN_DIVE, STALL_AIRSPEED, AOA_STALL_RAD,
  STALL_RECOVERY_MS, ROLL_SLEW_RAD_S, PITCH_SLEW_RAD_S, GLIDE_DESCENT_CAP,
});
