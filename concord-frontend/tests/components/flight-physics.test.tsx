/**
 * Concordia Phase 7 — flight-physics tests.
 *
 * Pins:
 *   - newFlightState default values
 *   - bank → yaw rate (positive roll → heading drift)
 *   - dive (pitch < -0.5) gains airspeed
 *   - level flight bleeds airspeed
 *   - high AoA + low airspeed enters stall
 *   - stall recovery requires nose-down for STALL_RECOVERY_MS
 *   - thermal lift counters glide descent
 *   - inactive flight clamps vy to [glide_cap, 0]
 */

import { describe, it, expect } from 'vitest';
import {
  newFlightState,
  stepFlight,
  FLIGHT_CONSTANTS,
} from '@/lib/concordia/flight-physics';

function defaultWind() {
  return { wind: { x: 0, y: 0, z: 0 }, lift: 0 };
}

describe('flight-physics — newFlightState', () => {
  it('starts at airspeed 10, level', () => {
    const s = newFlightState();
    expect(s.airspeed).toBe(10);
    expect(s.heading).toBe(0);
    expect(s.rollRad).toBe(0);
    expect(s.stalled).toBe(false);
  });
});

describe('flight-physics — banking', () => {
  it('right bank produces positive yaw rate', () => {
    let s = newFlightState();
    // Slew roll over multiple steps so it reaches its target.
    for (let i = 0; i < 30; i++) {
      s = stepFlight(s, { roll: 1, pitch: 0, active: true }, defaultWind(), 0.05);
    }
    expect(s.heading).toBeGreaterThan(0);
    expect(s.rollRad).toBeGreaterThan(0);
  });

  it('left bank produces negative yaw rate', () => {
    let s = newFlightState();
    for (let i = 0; i < 30; i++) {
      s = stepFlight(s, { roll: -1, pitch: 0, active: true }, defaultWind(), 0.05);
    }
    expect(s.heading).toBeLessThan(0);
  });
});

describe('flight-physics — airspeed', () => {
  it('dive gains airspeed', () => {
    let s = newFlightState();
    s.airspeed = 8;
    for (let i = 0; i < 10; i++) {
      s = stepFlight(s, { roll: 0, pitch: -1, active: true }, defaultWind(), 0.1);
    }
    expect(s.airspeed).toBeGreaterThan(8);
  });

  it('level flight bleeds airspeed', () => {
    let s = newFlightState();
    s.airspeed = 30;
    for (let i = 0; i < 20; i++) {
      s = stepFlight(s, { roll: 0, pitch: 0, active: true }, defaultWind(), 0.1);
    }
    expect(s.airspeed).toBeLessThan(30);
  });
});

describe('flight-physics — stall', () => {
  it('high AoA + low airspeed → enters stall', () => {
    let s = newFlightState();
    s.airspeed = 2;
    s.pitchRad = 0;
    s = stepFlight(s, { roll: 0, pitch: 1, active: true }, defaultWind(), 0.5);
    // After one big step with full nose-up + low airspeed, should stall.
    expect(s.stalled).toBe(true);
  });

  it('stall recovery requires nose-down', () => {
    let s = newFlightState();
    s.stalled = true;
    s.airspeed = 1;
    // Step dt is clamped to 0.25s; need enough steps to accumulate
    // STALL_RECOVERY_MS of nose-down time.
    const stepCount = Math.ceil(FLIGHT_CONSTANTS.STALL_RECOVERY_MS / 200) + 1;
    for (let i = 0; i < stepCount; i++) {
      s = stepFlight(s, { roll: 0, pitch: -1, active: true }, defaultWind(), 0.2);
    }
    expect(s.stalled).toBe(false);
  });

  it('staying nose-up does not recover stall', () => {
    let s = newFlightState();
    s.stalled = true;
    s.airspeed = 1;
    for (let i = 0; i < 20; i++) {
      s = stepFlight(s, { roll: 0, pitch: 0.5, active: true }, defaultWind(), 0.2);
    }
    expect(s.stalled).toBe(true);
  });
});

describe('flight-physics — thermal lift', () => {
  it('positive lift reduces descent', () => {
    let s = newFlightState();
    s = stepFlight(s, { roll: 0, pitch: 0, active: true }, { wind: { x: 0, y: 0, z: 0 }, lift: 3 }, 1);
    // vy should be positive or near zero after big lift.
    expect(s.vy).toBeGreaterThan(FLIGHT_CONSTANTS.GLIDE_DESCENT_CAP);
  });

  it('inactive flight clamps vy to [glide_cap, 0]', () => {
    let s = newFlightState();
    s.vy = -10;
    s = stepFlight(s, { roll: 0, pitch: 0, active: false }, defaultWind(), 1);
    expect(s.vy).toBeGreaterThanOrEqual(FLIGHT_CONSTANTS.GLIDE_DESCENT_CAP);
    expect(s.vy).toBeLessThanOrEqual(0);
  });
});
