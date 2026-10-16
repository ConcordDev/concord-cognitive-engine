import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Workbench } from './Workbench';
import { neighbourhood, type WorkbenchClient, type WorkbenchView } from '@/lib/conkay/workbench-api';

vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const VIEW: WorkbenchView = {
  version: '1.0.0', revision: 0, receipt: 'd8c7cc281e676b5024c3', state: { fuelType: 'electric' }, locked: [],
  knobs: [
    { variable: 'tailExtensionM', label: 'Tail length', value: 0.22, unit: 'm', bounds: [0, 1], step: 0.1, locked: false, source: 'repair table' },
    { variable: 'motorId', label: 'Drive unit', value: 'motor.cascadia.im-225-dz', options: ['motor.cascadia.im-225-dz', 'motor.cascadia.im-375-dz'], locked: false, source: 'library' },
  ],
  graph: {
    nodes: [
      { id: 'knob:tailExtensionM', kind: 'knob', label: 'Tail length', depth: 0 },
      { id: 'cad.body@BODY_SHELL', kind: 'run', label: 'cad.body@BODY_SHELL', status: 'PASS', depth: 1 },
      { id: 'aero.drag-buildup@VEH', kind: 'run', label: 'aero.drag-buildup@VEH', status: 'WARN', depth: 2 },
      { id: 'requirement.check@REQ_topSpeed', kind: 'run', label: 'requirement.check@REQ_topSpeed', status: 'PASS', depth: 3 },
    ],
    edges: [
      { from: 'knob:tailExtensionM', to: 'cad.body@BODY_SHELL', kind: 'reads' },
      { from: 'cad.body@BODY_SHELL', to: 'aero.drag-buildup@VEH', kind: 'result' },
      { from: 'aero.drag-buildup@VEH', to: 'requirement.check@REQ_topSpeed', kind: 'result' },
    ],
  },
  checks: [{
    runId: 'requirement.check@REQ_topSpeed', status: 'PASS',
    solver: { id: 'requirement.check', version: '1.0.0', fidelity: 'L0', method: 'compare a solver output with the requirement bound', reference: null, regime: null, units: null, tolerance: null, screening: null },
    inputHash: 'abc123', inputs: {}, margins: [{ check: 'go 180 mph', demand: 80.4672, capacity: 81.94, unit: 'm/s', utilization: 0.982 }],
    warnings: [], failures: [], assumptions: [], sources: ['https://www.cascadiamotion.com/x.pdf'],
    explanation: 'go 180 mph: utilization = demand / capacity = 80.467 m/s / 81.94 m/s = 0.98202 — at or under 1, so it holds.\nPassing a software check is not physical validation.',
  }],
};

function fakeClient(): WorkbenchClient & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    knob: vi.fn(async (...a) => { calls.push(['knob', ...a]); return { reply: { kind: 'parameter', ok: true, diff: { changed: [{ field: 'BODY_SHELL tail', before: 0.22, after: 0.32, source: 'Workbench knob' }], flipped: [], rerun: ['cad.body@BODY_SHELL'] } }, view: { ...VIEW, revision: 1 } }; }),
    lock: vi.fn(async (...a) => { calls.push(['lock', ...a]); return { view: { ...VIEW, locked: ['motorId'], knobs: VIEW.knobs.map((k) => (k.variable === 'motorId' ? { ...k, locked: true } : k)) } }; }),
    ask: vi.fn(async (...a) => { calls.push(['ask', ...a]); return { reply: { kind: 'requirement', ok: true, diff: { changed: [{ field: 'topSpeed', before: 80.47, after: 67.06, source: 'the user\'s words "150 mph"' }], flipped: [{ runId: 'requirement.check@REQ_topSpeed', from: 'FAIL', to: 'PASS' }], rerun: 'rebuilt' } }, view: { ...VIEW, revision: 2 } }; }),
    undo: vi.fn(async () => ({ reply: { kind: 'undo', ok: true, matches: true }, view: { ...VIEW, revision: 0 } })),
    get: vi.fn(async () => ({ view: VIEW })),
  };
}

describe('Workbench', () => {
  it('a knob move goes to the server and the reply shows what changed', async () => {
    const c = fakeClient();
    render(<Workbench id="w1" initialView={VIEW} client={c} />);
    const knob = screen.getByTestId('wb-knob-tailExtensionM');
    fireEvent.change(knob.querySelector('input[type="range"]')!, { target: { value: '0.32' } });
    fireEvent.click(within(knob).getByRole('button', { name: 'Set' }));
    await waitFor(() => expect(c.calls).toContainEqual(['knob', 'w1', 'tailExtensionM', 0.32]));
    await waitFor(() => expect(screen.getByTestId('wb-reply').textContent).toMatch(/BODY_SHELL tail: 0.22 → 0.32/));
    expect(screen.getByTestId('wb-revision').textContent).toBe('1');
  });

  it('locking a variable disables its control and shows it locked', async () => {
    const c = fakeClient();
    render(<Workbench id="w1" initialView={VIEW} client={c} />);
    fireEvent.click(screen.getByRole('button', { name: 'lock Drive unit' }));
    await waitFor(() => expect(c.calls).toContainEqual(['lock', 'w1', 'motorId', true]));
    await waitFor(() => expect(screen.getByTestId('wb-locked').textContent).toMatch(/motorId/));
    expect((screen.getByRole('combobox', { name: 'Drive unit' }) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'unlock Drive unit' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('selecting a check opens its receipt with the substituted explanation, and lights its upstream', () => {
    render(<Workbench id="w1" initialView={VIEW} client={fakeClient()} />);
    fireEvent.click(screen.getByTestId('wb-node-requirement.check@REQ_topSpeed'));
    const r = screen.getByTestId('wb-receipt');
    expect(r.textContent).toMatch(/requirement\.check@1\.0\.0/);
    expect(r.textContent).toMatch(/abc123/);
    expect(screen.getByTestId('wb-explanation').textContent).toMatch(/80\.467 m\/s \/ 81\.94 m\/s = 0\.98202/);
    expect(r.querySelector('a')?.getAttribute('href')).toBe('https://www.cascadiamotion.com/x.pdf');
    expect(screen.getByTestId('wb-node-cad.body@BODY_SHELL').className).toMatch(/ring-violet/);
  });

  it('a typed follow-up takes the same path and lists the checks that flipped; undo goes back', async () => {
    const c = fakeClient();
    render(<Workbench id="w1" initialView={VIEW} client={c} />);
    fireEvent.change(screen.getByLabelText('follow-up'), { target: { value: 'what about 150 mph' } });
    fireEvent.submit(screen.getByLabelText('follow-up').closest('form')!);
    await waitFor(() => expect(c.calls).toContainEqual(['ask', 'w1', 'what about 150 mph']));
    await waitFor(() => expect(screen.getByTestId('wb-reply').textContent).toMatch(/requirement\.check@REQ_topSpeed: FAIL → PASS/));
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(screen.getByTestId('wb-revision').textContent).toBe('0'));
  });
});

describe('neighbourhood', () => {
  it('walks upstream and downstream along the edges', () => {
    const h = neighbourhood(VIEW.graph.edges, 'aero.drag-buildup@VEH');
    expect([...h.up].sort()).toEqual(['cad.body@BODY_SHELL', 'knob:tailExtensionM']);
    expect([...h.down]).toEqual(['requirement.check@REQ_topSpeed']);
  });
});
