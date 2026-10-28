import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { explodedShift, sectionPlane } from '@/lib/conkay/assembly-view';
import type { KnobResponse, WorkbenchClient, WorkbenchView } from '@/lib/conkay/workbench-api';

vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="webgl" />,
  useThree: () => ({ gl: {}, scene: {} }),
}));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null, ContactShadows: () => null }));
vi.mock('three/examples/jsm/environments/RoomEnvironment.js', () => ({ RoomEnvironment: class {} }));
vi.mock('three/examples/jsm/loaders/HDRLoader.js', () => ({ HDRLoader: class { load() {} } }));

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

  it('switches studio paint and offers the presentation GLB only for the analysed solid', () => {
    const cad = { ...assembly, surface: { ...assembly.surface, source: 'cad.body' as const } };
    const { unmount } = render(<AssemblyViewer assembly={cad} glbUrl="/api/conkay/demo/designs/car/present.glb" />);
    expect(screen.getByTestId('paint-graphite').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('paint-silver'));
    expect(screen.getByTestId('paint-silver').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('paint-graphite').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('present-glb').getAttribute('href')).toBe('/api/conkay/demo/designs/car/present.glb');
    fireEvent.click(screen.getByText('Engineering'));
    expect(screen.queryByTestId('paint-silver')).toBeNull();
    unmount();
    // a styling-preview surface is not the analysed solid: no GLB link
    render(<AssemblyViewer assembly={assembly} glbUrl="/x.glb" />);
    expect(screen.queryByTestId('present-glb')).toBeNull();
  });

  it('offers the design-surface overlays and lists the style-reference conflicts for the analysed solid only', () => {
    const overlays = {
      source: 'cad.design-surface' as const, onSolid: 'cad.body' as const, skinTrimmed: false as const,
      panelLines: [{ id: 'door-front-L', kind: 'door-cut', side: 'L', polylines: [[0, 0, 0, 1, 0, 0]], samples: 2, missed: 0 }],
      glass: [], lamps: [],
      coverage: { samples: 100, missed: 2 },
      conflicts: [{ id: 'rear-doors-b-pillar', reference: 'The image is a two-door coupe.', package: 'The package seats four.', copied: false }],
    };
    const cad = { ...assembly, surface: { ...assembly.surface, source: 'cad.body' as const, overlays } };
    const { unmount } = render(<AssemblyViewer assembly={cad} />);
    const toggle = screen.getByTestId('overlays-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    const conflicts = screen.getByTestId('style-conflicts').textContent || '';
    expect(conflicts).toMatch(/not copied/);
    expect(conflicts).toMatch(/rear-doors-b-pillar/);
    expect(conflicts).toMatch(/2 of 100 overlay points miss the solid/);
    unmount();
    // a styling-preview surface never shows overlays made for a solid
    render(<AssemblyViewer assembly={{ ...assembly, surface: { ...assembly.surface, overlays } }} />);
    expect(screen.queryByTestId('overlays-toggle')).toBeNull();
    expect(screen.queryByTestId('style-conflicts')).toBeNull();
  });

  it('stays view-only when asked, and still mounts the canvas', () => {
    render(<AssemblyViewer assembly={assembly} viewOnly />);
    expect(screen.queryByTestId('explode')).toBeNull();
    expect(screen.getByText(/View only/)).toBeTruthy();
    expect(screen.getByTestId('webgl')).toBeTruthy();
    expect(screen.getByTestId('studio-preview-badge').textContent).toMatch(/engineering geometry is authoritative/);
  });
});

describe('AssemblyViewer workbench mode (HANDOFF-3 A2)', () => {
  const wbView = (wheelbase: number, lockedWb = false): WorkbenchView => ({
    version: '1.1.0', revision: 0, receipt: 'r0', state: {},
    knobs: [
      { variable: 'wheelbaseM', label: 'Wheelbase', value: wheelbase, unit: 'm', bounds: [2.4, 3.6], step: 0.01, locked: lockedWb, source: 'VEH props.vehicle' },
      { variable: 'seatHPointZM', label: 'Seat H-point z', value: 0.34, unit: 'm', bounds: [0.28, 0.6], step: 0.005, locked: true, source: 'package design choice h30' },
    ],
    locked: ['seatHPointZM'],
    graph: { nodes: [], edges: [] },
    checks: [],
  });
  const editedAssembly: VehicleAssembly = {
    ...assembly,
    components: assembly.components.map((c) => (c.id === 'BODY_SHELL'
      ? { ...c, parameters: [{ id: 'overallHeight', name: 'Overall height', value: 9.99, unit: 'm', provenance: { state: 'calculated' } }] }
      : c)),
    checks: [
      { id: 'head-M95', status: 'pass', detail: 'clears' },
      { id: 'wheel-footwell', status: 'fail', detail: 'foot boxes reach the steering sweep' },
      { id: 'containment', status: 'fail', detail: 'a part sits outside the body', outside: ['TIRE_FL'] },
    ],
  };
  const response = (wheelbase: number): KnobResponse => ({
    reply: {
      kind: 'parameter', ok: true,
      diff: { changed: [{ field: 'wheelbase', before: 3.019, after: wheelbase, unit: 'm', source: 'Workbench knob' }], flipped: [{ runId: 'assembly.vehicle@VEH', from: 'PASS', to: 'FAIL' }], rerun: ['assembly.vehicle@VEH'] },
    },
    view: wbView(wheelbase),
    fitCheckDiff: [{ id: 'wheel-footwell', from: 'pass', to: 'fail' }],
    rerun: ['assembly.vehicle@VEH', 'package.occupant-fit@VEH'],
    assembly: editedAssembly as unknown as KnobResponse['assembly'],
  });

  it('commits a knob edit, swaps the model in and shows the fit-check diff', async () => {
    const knob = vi.fn(async () => response(2.8));
    const client = { knob } as unknown as WorkbenchClient;
    const onView = vi.fn();
    render(<AssemblyViewer assembly={assembly} workbench={{ id: 'wb-1', view: wbView(3.019), client, onView }} />);
    const input = screen.getByTestId('viewer-knob-wheelbaseM-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2.8' } });
    fireEvent.click(screen.getByTestId('viewer-knob-wheelbaseM-set'));
    const diff = await screen.findByTestId('wb-diff');
    expect(knob).toHaveBeenCalledWith('wb-1', 'wheelbaseM', 2.8);
    expect(diff.textContent).toMatch(/wheelbase: 3\.019 → 2\.8 m/);
    expect(diff.textContent).toMatch(/wheel-footwell: pass → fail/);
    expect(diff.textContent).toMatch(/2 solver runs re-ran/);
    expect(onView).toHaveBeenCalled();
    // the model swapped: the Fit list is the edited assembly's, and its own parameter values show
    expect(screen.getByTestId('fit-wheel-footwell').textContent).toMatch(/fail/);
    fireEvent.click(screen.getByTestId('part-BODY_SHELL'));
    expect(screen.getByTestId('inspector').textContent).toMatch(/9\.99/);
  });

  it('a locked knob renders locked and cannot be set', () => {
    const knob = vi.fn(async () => response(2.8));
    const client = { knob } as unknown as WorkbenchClient;
    render(<AssemblyViewer assembly={assembly} workbench={{ id: 'wb-1', view: wbView(3.019), client }} />);
    const input = screen.getByTestId('viewer-knob-seatHPointZM-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect((screen.getByTestId('viewer-knob-seatHPointZM-set') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('viewer-knob-seatHPointZM').textContent).toMatch(/is locked: unlock it to change it/);
    expect(knob).not.toHaveBeenCalled();
  });

  it('a refused edit shows the server message and keeps the model', async () => {
    const knob = vi.fn(async () => { throw { response: { data: { message: 'wheelbaseM must be within 2.4..3.6 m' } } }; });
    const client = { knob } as unknown as WorkbenchClient;
    render(<AssemblyViewer assembly={assembly} workbench={{ id: 'wb-1', view: wbView(3.019), client }} />);
    fireEvent.change(screen.getByTestId('viewer-knob-wheelbaseM-input'), { target: { value: '3.5' } });
    fireEvent.click(screen.getByTestId('viewer-knob-wheelbaseM-set'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/must be within 2\.4\.\.3\.6 m/);
    expect(screen.queryByTestId('wb-diff')).toBeNull();
    expect(screen.queryByTestId('fit-wheel-footwell')).toBeNull();
  });

  it('snapshot mode offers Start editing; plain mode offers neither', () => {
    const onStart = vi.fn();
    const { unmount } = render(<AssemblyViewer assembly={assembly} onStartEditing={onStart} />);
    fireEvent.click(screen.getByTestId('start-editing'));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('wb-edit')).toBeNull();
    unmount();
    render(<AssemblyViewer assembly={assembly} />);
    expect(screen.queryByTestId('start-editing')).toBeNull();
    expect(screen.queryByTestId('wb-edit')).toBeNull();
  });
});

describe('AssemblyViewer relationships, clearances and checks overlay (HANDOFF-3 A3)', () => {
  const a3: VehicleAssembly = {
    ...assembly,
    verification: { statement: 'Geometric assembly. Not manufactured.', geometricOnlyParts: ['BODY_SHELL', 'TRUNK'] },
    components: [
      {
        id: 'BODY_SHELL', name: 'Body loft', group: 'exterior', role: 'body',
        placement: { x: 2, y: 0, z: 0.6 }, half: [2, 0.9, 0.5],
        geometry: { kind: 'envelope', label: 'parametric loft' },
        relationships: [
          { kind: 'constrained-by', target: 'SEAT_1', note: 'clears the driver' },
          { kind: 'references', target: 'GHOST', note: 'not a component in this document' },
        ],
        explode: { axis: 'z', sign: 1, rank: 3 },
      },
      {
        id: 'SEAT_1', name: 'Driver seat', group: 'interior', role: 'seat',
        placement: { x: 1.8, y: -0.37, z: 0.34 }, half: [0.28, 0.25, 0.45],
        geometry: { kind: 'envelope', label: 'library seat' },
        explode: { axis: 'z', sign: 1, rank: 3 },
      },
      {
        id: 'TIRE_FL', name: 'TIRE_FL', group: 'wheels', role: 'wheel',
        placement: { x: 1, y: -0.8, z: 0.33 }, half: [0.33, 0.12, 0.33],
        geometry: { kind: 'envelope', label: 'tyre' },
        explode: { axis: 'y', sign: -1, rank: 2 },
      },
      {
        id: 'TRUNK', name: 'Trunk volume', group: 'storage', role: 'volume',
        placement: { x: 3.6, y: 0, z: 0.6 }, half: [0.4, 0.6, 0.25],
        geometry: { kind: 'envelope', label: 'volume box' },
        explode: { axis: 'x', sign: 1, rank: 2 },
      },
    ],
    checks: [
      { id: 'head-M95', status: 'pass', detail: 'head clears the roof', parts: ['SEAT_1', 'BODY_SHELL'], clearanceM: 0.076 },
      { id: 'wheel-footwell', status: 'fail', detail: 'the swept tyre reaches the foot box', parts: ['TIRE_FL', 'SEAT_1'], clearanceM: -0.012 },
      { id: 'containment', status: 'warn', detail: 'the trunk box crosses the styled surface', outside: ['TRUNK'] },
    ],
  };

  it('relationship click-through selects the target part; a target that is not a component stays plain text', () => {
    render(<AssemblyViewer assembly={a3} />);
    fireEvent.click(screen.getByTestId('part-BODY_SHELL'));
    expect(screen.getByTestId('rel-BODY_SHELL-SEAT_1')).toBeTruthy();
    expect(screen.queryByTestId('rel-BODY_SHELL-GHOST')).toBeNull();
    expect(screen.getByTestId('inspector').textContent).toMatch(/GHOST/);
    fireEvent.click(screen.getByTestId('rel-BODY_SHELL-SEAT_1'));
    expect(screen.getByTestId('inspector').textContent).toMatch(/Driver seat/);
  });

  it('the provenance badge separates geometric-only parts from verified envelopes', () => {
    render(<AssemblyViewer assembly={a3} />);
    fireEvent.click(screen.getByTestId('part-BODY_SHELL'));
    expect(screen.getByTestId('part-badge').textContent).toMatch(/Geometric only/);
    fireEvent.click(screen.getByTestId('part-TRUNK'));
    expect(screen.getByTestId('part-badge').textContent).toMatch(/Geometric only/);
    fireEvent.click(screen.getByTestId('part-SEAT_1'));
    expect(screen.getByTestId('part-badge').textContent).toMatch(/Verified envelope/);
  });

  it('clearances are the stored solver gaps of the checks naming the part, in mm', () => {
    render(<AssemblyViewer assembly={a3} />);
    fireEvent.click(screen.getByTestId('part-SEAT_1'));
    expect(screen.getByTestId('clearance-head-M95').textContent).toMatch(/76 mm \(pass\)/);
    expect(screen.getByTestId('clearance-wheel-footwell').textContent).toMatch(/-12 mm \(fail\)/);
    fireEvent.click(screen.getByTestId('part-TIRE_FL'));
    expect(screen.getByTestId('clearance-wheel-footwell')).toBeTruthy();
    expect(screen.queryByTestId('clearance-head-M95')).toBeNull();
    fireEvent.click(screen.getByTestId('part-TRUNK'));
    expect(screen.queryByTestId('part-clearances')).toBeNull();
  });

  it('the Checks overlay exists in Engineering only and reports each part\'s worst check', () => {
    render(<AssemblyViewer assembly={a3} />);
    expect(screen.queryByTestId('checks-overlay')).toBeNull();
    fireEvent.click(screen.getByText('Engineering'));
    expect(screen.queryByTestId('part-check-TIRE_FL')).toBeNull();
    fireEvent.click(screen.getByTestId('checks-overlay'));
    expect(screen.getByTestId('part-check-TIRE_FL').textContent).toMatch(/fail/);
    expect(screen.getByTestId('part-check-SEAT_1').textContent).toMatch(/fail/); // pass head + fail footwell → fail
    expect(screen.getByTestId('part-check-TRUNK').textContent).toMatch(/warn/); // via containment's outside list
    expect(screen.getByTestId('part-check-BODY_SHELL').textContent).toMatch(/pass/);
    fireEvent.click(screen.getByTestId('checks-overlay'));
    expect(screen.queryByTestId('part-check-TIRE_FL')).toBeNull();
  });

  it('clicking a Fit check focuses it (aria-pressed) and selects its first named part', () => {
    render(<AssemblyViewer assembly={a3} />);
    const btn = screen.getByTestId('fit-wheel-footwell').querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('inspector').textContent).toMatch(/TIRE_FL/);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });
});
