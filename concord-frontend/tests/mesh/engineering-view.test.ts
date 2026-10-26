import { describe, expect, it } from 'vitest';
import {
  applySectionClip, massLabel, measureDistance, partVisibility, pushMeasurePoint, sectionPlaneAt, VIEW_DIRECTION, visibleIndices,
} from '@/lib/mesh/engineering-view';
import { meshToGlb, meshToStep, meshToStl } from '@/lib/mesh/mesh-export';

describe('engineering view', () => {
  it('measures the last two points and builds a +X section plane', () => {
    expect(measureDistance([0, 0, 0], [3, 4, 0])).toBe(5);
    expect(pushMeasurePoint([[0, 0, 0], [1, 0, 0]], [0, 1, 0])).toEqual([[1, 0, 0], [0, 1, 0]]);
    expect(sectionPlaneAt(12)).toEqual({ normal: [1, 0, 0], constant: -12 });
    expect(VIEW_DIRECTION.front.label).toBe('Front (+Z)');
    expect(VIEW_DIRECTION.top.position).toEqual([0, 1, 0]);
    expect(VIEW_DIRECTION.side.position).toEqual([1, 0, 0]);
  });

  it('clips every mesh, including a tyre, and hides or isolates parts', () => {
    const tyre = { name: 'tyre', isMesh: true, material: { clippingPlanes: undefined as unknown, needsUpdate: false } };
    const body = { name: 'body', isMesh: true, material: { clippingPlanes: undefined as unknown, needsUpdate: false } };
    const root = { traverse(fn: (obj: typeof tyre) => void) { fn(tyre); fn(body); } };
    expect(applySectionClip(root, [{ constant: -1 }])).toBe(2);
    expect(tyre.material.needsUpdate).toBe(true);
    expect(tyre.material.clippingPlanes).toEqual([{ constant: -1 }]);
    const hidden = new Set(['arm']);
    expect(partVisibility('arm', hidden, null)).toBe(false);
    expect(partVisibility('torso', hidden, 'torso')).toBe(true);
    expect(partVisibility('arm', hidden, 'torso')).toBe(false);
    const indices = [0, 1, 2, 3, 4, 5];
    expect(visibleIndices(indices, [{ name: 'a', nodeName: 'a', i0: 0, i1: 3 }, { name: 'b', nodeName: 'b', i0: 3, i1: 6 }], new Set(['b']), null)).toEqual([0, 1, 2]);
  });

  it('states a real mass and refuses a stand-in', () => {
    expect(massLabel({ massKg: 0.54, massNote: 'unused' })).toBe('0.54 kg');
    const none = massLabel({ massKg: null, massNote: 'No material is assigned on this layout, so mass is not computed.' });
    expect(none).toMatch(/No material is assigned/);
    expect(none).not.toMatch(/kg/);
    expect(massLabel(null)).toBe('');
  });

  it('writes STL, GLB, and a faceted STEP that says it is not a B-rep', () => {
    const positions = [0, 0, 0, 10, 0, 0, 0, 10, 0];
    const indices = [0, 1, 2];
    const stl = new Uint8Array(meshToStl(positions, indices));
    expect(stl.length).toBe(84 + 50);
    expect(new TextDecoder().decode(stl.slice(0, 24))).toMatch(/Concord STL millimetres/);
    const glb = meshToGlb(positions, indices, 'plate');
    expect(new TextDecoder().decode(glb.slice(0, 4))).toBe('glTF');
    const step = meshToStep(positions, indices);
    expect(step).toMatch(/ISO-10303-21/);
    expect(step).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
    expect(step).toMatch(/FACETED_BREP/);
    expect(step).toMatch(/Not an OpenCascade or SolidWorks B-rep solid/);
  });
});
