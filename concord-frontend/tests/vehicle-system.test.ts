/**
 * Wave 7b — vehicle kinematics (previously dead code, never called). Pins the
 * stepVehicle physics + the createVehicleController driver-loop primitive so the
 * engine is confirmed sound for when the chair wires it to live input.
 */

import { describe, it, expect } from 'vitest';
import { stepVehicle, createVehicleController, emptyPose, VEHICLE_SPECS } from '@/lib/world-lens/vehicle-system';

describe('stepVehicle kinematics', () => {
  it('car throttle accelerates forward (+z at heading 0)', () => {
    const p = stepVehicle('car', emptyPose(), { throttle: 1, steer: 0 }, 0.5);
    expect(p.vz).toBeGreaterThan(0);
  });

  it('steer changes heading', () => {
    const p = stepVehicle('car', emptyPose(), { throttle: 0, steer: 1 }, 0.5);
    expect(p.ry).toBeGreaterThan(0);
    expect(Math.abs(p.ry - VEHICLE_SPECS.car.turnRate * 0.5)).toBeLessThan(1e-6);
  });

  it('brake decelerates / reverses thrust', () => {
    const moving = { ...emptyPose(), vz: 10 };
    const p = stepVehicle('car', moving, { throttle: 0, steer: 0, brake: true }, 0.2);
    expect(p.vz).toBeLessThan(10);
  });

  it('plane gains altitude from lift at speed', () => {
    const fast = { ...emptyPose(), vz: 100 };
    const p = stepVehicle('plane', fast, { throttle: 1, steer: 0, pitch: 0 }, 0.2);
    expect(p.vy).toBeGreaterThan(0); // lift overcomes (plane has no gravity)
  });
});

describe('createVehicleController driver loop', () => {
  it('integrates pose over ticks from inputs', () => {
    const c = createVehicleController('car');
    c.setInputs({ throttle: 1 });
    c.tick(0.5);
    c.tick(0.5);
    const pose = c.getPose();
    expect(pose.z).not.toBe(0); // moved forward over two ticks
    expect(pose.vz).toBeGreaterThan(0);
  });

  it('reset returns to a clean pose', () => {
    const c = createVehicleController('glider', { y: 50 });
    c.setInputs({ throttle: 1 });
    c.tick(1);
    c.reset({ y: 10 });
    expect(c.getPose().y).toBe(10);
    expect(c.getPose().vz).toBe(0);
  });
});
