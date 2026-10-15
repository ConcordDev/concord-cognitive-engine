import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { explodedShift, sectionPlane } from '@/lib/conkay/assembly-view';

vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="webgl" />,
  useThree: () => ({ gl: {}, scene: {} }),
}));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null, ContactShadows: () => null }));
vi.mock('three/examples/jsm/environments/RoomEnvironment.js', () => ({ RoomEnvironment: class {} }));

import { AssemblyViewer, type VehicleAssembly } from './AssemblyViewer';

const assembly: VehicleAssembly = {
  verification: { statement: 'Geometric assembly. Not manufactured.' },
  components: [
    {
      id: 'BODY_SHELL', name: 'Body loft', group: 'exterior', role: 'body',
      placement: { x: 2, y: 0, z: 0.6 }, half: [2, 0.9, 0.5],
      geometry: { kind: 'envelope', label: 'parametric loft' },
      parameters: [{ id: 'overallHeight', name: 'Overall height', value: 1.2, unit: 'm', provenance: { state: 'calculated', note: 'from the head' } }],
      relationships: [{ kind: 'constrained-by', target: 'SEAT_1', note: 'clears the driver' }],
      explode: { axis: 'z', sign: 1, rank: 3 },
    },
    {
      id: 'TIRE_FL', name: 'TIRE_FL', group: 'wheels', role: 'wheel',
      placement: { x: 1, y: -0.8, z: 0.33 }, half: [0.33, 0.12, 0.33],
      geometry: { kind: 'envelope', label: 'tyre' },
      explode: { axis: 'y', sign: -1, rank: 2 },
    },
  ],
  checks: [
    { id: 'head-M95', status: 'pass', detail: 'clears' },
    { id: 'ingress', status: 'fail', detail: 'aperture short' },
  ],
  surface: {
    mesh: {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      paint: [0, 1, 2],
      glass: [],
      bounds: { min: [0, -1, 0], max: [4, 1, 1.2] },
    },
  },
  wheel: {
    tire: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] },
    rim: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
    disc: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
    caliper: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
  },
};

describe('assembly view math', () => {
  it('explodes along the part axis and builds a section plane', () => {
    const moved = explodedShift({ id: 'TIRE_FL', placement: { x: 1, y: -0.8, z: 0.33 }, explode: { axis: 'y', sign: -1, rank: 2 } }, 1);
    expect(moved[0]).toBeCloseTo(1);
    expect(moved[1]).toBeCloseTo(-0.8 - 0.44);
    expect(moved[2]).toBeCloseTo(0.33);
    expect(explodedShift({ id: 'a', placement: { x: 1, y: 2, z: 3 }, explode: { axis: 'z', sign: 1, rank: 1 } }, 0)).toEqual([1, 2, 3]);
    expect(sectionPlane('x', 1.5)).toEqual({ normal: [1, 0, 0], constant: -1.5 });
    expect(sectionPlane('z', 0.8).normal).toEqual([0, -1, 0]);
    // The viewer centres the car on x; a cut at vehicle x=2.0 with the car
    // centred at 2.4 sits at world x=-0.4.
    expect(sectionPlane('x', 2.0, 2.4).constant).toBeCloseTo(0.4);
    expect(sectionPlane('y', 0.3, 2.4)).toEqual(sectionPlane('y', 0.3));
  });
});

describe('AssemblyViewer', () => {
  it('selects a part, explodes, and opens a section plane', () => {
    render(<AssemblyViewer assembly={assembly} />);
    expect(screen.getByTestId('studio-preview-badge').textContent).toMatch(/styling preview/);
    fireEvent.click(screen.getByTestId('part-BODY_SHELL'));
    expect(screen.getByTestId('inspector').textContent).toMatch(/Body loft/);
    expect(screen.getByTestId('inspector').textContent).toMatch(/calculated/);
    expect(screen.getByTestId('fit-ingress').textContent).toMatch(/fail/);
    fireEvent.change(screen.getByTestId('explode'), { target: { value: '0.4' } });
    expect((screen.getByTestId('explode') as HTMLInputElement).value).toBe('0.4');
    fireEvent.click(screen.getByTestId('section-y'));
    expect(screen.getByTestId('section-pos')).toBeTruthy();
    fireEvent.click(screen.getByText('Engineering'));
    expect(screen.getByText('Engineering').className).toMatch(/bg-white/);
    expect(screen.queryByTestId('studio-preview-badge')).toBeNull();
  });

  it('labels the drawn body as the analysed solid when the surface is cad.body', () => {
    const cad = { ...assembly, surface: { ...assembly.surface, source: 'cad.body' as const } };
    render(<AssemblyViewer assembly={cad} />);
    const badge = screen.getByTestId('studio-preview-badge').textContent || '';
    expect(badge).toMatch(/analysed body \(cad\.body solid\)/);
    expect(badge).not.toMatch(/styling preview/);
  });

  it('stays view-only when asked, and still mounts the canvas', () => {
    render(<AssemblyViewer assembly={assembly} viewOnly />);
    expect(screen.queryByTestId('explode')).toBeNull();
    expect(screen.getByText(/View only/)).toBeTruthy();
    expect(screen.getByTestId('webgl')).toBeTruthy();
    expect(screen.getByTestId('studio-preview-badge').textContent).toMatch(/engineering geometry is authoritative/);
  });
});
