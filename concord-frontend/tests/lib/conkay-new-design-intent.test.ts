import { describe, it, expect } from 'vitest';
import { detectNewDesign, namesNonBeamObject } from '@/lib/conkay/new-design-intent';
import { parseWorkspaceCommand } from '@/lib/conkay/workspace-commands';

const DIMS = { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 };
const MATERIALS = [
  { id: 'steel-a992', label: 'ASTM A992 Steel (50 ksi)' },
  { id: 'aluminum-6061-t6', label: 'Aluminum 6061-T6' },
  { id: 'aluminum-7075-t6', label: 'Aluminum 7075-T6' },
];

describe('workspace box routing: new design vs beam edit', () => {
  it.each([
    ['design me a pedestrian bridge 30 m span 5 kN steel', { kind: 'workbench', domain: 'truss' }],
    ['build a footbridge over the creek', { kind: 'workbench', domain: 'truss' }],
    ['design a Warren truss, 12 m span', { kind: 'workbench', domain: 'truss' }],
    ['show me the car', { kind: 'showcase', id: 'car' }],
    ['design a four-seat electric car that holds 140 mph', { kind: 'workbench', domain: 'car' }],
    ['make a steel bracket for 2 kN', { kind: 'workbench', domain: 'bracket' }],
    ['show me Sentinel', { kind: 'showcase', id: 'sentinel-m1' }],
    ['design the Sentinel knee actuator bracket', { kind: 'workbench', domain: 'sentinel-part' }],
    ['show me the reactor', { kind: 'showcase', id: 'nuscale-us600' }],
    ['design a nuclear plant', { kind: 'showcase', id: 'nuscale-us600' }],
    ['show me the material formulation', { kind: 'showcase', id: 'usb-blend-d' }],
  ])('%s', (text, want) => {
    expect(detectNewDesign(text)).toMatchObject(want);
  });

  it.each([
    '3 m aluminum beam SF 1.5',
    'Design a 3 m simply supported aluminum beam carrying 5 kN at midspan with a safety factor of 1.5',
    'size a steel beam bridge girder 12 m',
    't_w = 8 mm and re-run',
    'make it aluminum',
    'show me the 3D view',
  ])('stays a beam edit (or agent): %s', (text) => {
    expect(detectNewDesign(text)).toBeNull();
  });

  it('"3 m aluminum beam SF 1.5" edits the beam', () => {
    const cmd = parseWorkspaceCommand('3 m aluminum beam SF 1.5', DIMS, MATERIALS, 'steel-a992');
    expect(cmd).toMatchObject({ dims: { length: 3000 }, materialId: 'aluminum-6061-t6', requiredSafetyFactor: 1.5 });
  });

  it('parseWorkspaceCommand backs off when another object is named', () => {
    expect(namesNonBeamObject('design me a pedestrian bridge 30 m span 5 kN steel')).toBe(true);
    expect(parseWorkspaceCommand('design me a pedestrian bridge 30 m span 5 kN steel', DIMS, MATERIALS)).toBeNull();
    expect(parseWorkspaceCommand('a car with 3 m wheelbase', DIMS, MATERIALS)).toBeNull();
    // a beam named with it is still an edit
    expect(parseWorkspaceCommand('a 3 m beam for the bridge deck', DIMS, MATERIALS)?.dims.length).toBe(3000);
  });
});
