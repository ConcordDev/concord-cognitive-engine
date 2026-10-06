// ConKay workspace (/lenses/conkay): study edits re-solve through
// engineering.beamStudy and replies are composed from the solver's numbers;
// nothing is shown as a result before a solve; the conversation is kept
// server-side; cross-lens handoffs (?ask=, ?dtu=) land in the same workspace.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const routerReplace = vi.fn();
const routerPush = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  usePathname: () => '/lenses/conkay',
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="beam-viewport" /> }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/components/conkay/useConKayVoice', () => ({
  useConKayVoice: () => ({ supported: true, listening: false, speaking: false, interim: '', usingServerStt: false, voiceUnavailable: false, ttsAmplitudeRef: { current: 0 }, speak: vi.fn(), cancelSpeak: vi.fn() }),
}));
vi.mock('@/components/conkay/useMicAmplitude', () => ({ useMicAmplitude: () => ({ current: 0 }) }));
const streamMock = vi.fn();
vi.mock('@/lib/conkay/agent-stream', async (orig) => ({
  ...(await orig<typeof import('@/lib/conkay/agent-stream')>()),
  streamConKayAgent: (...a: unknown[]) => streamMock(...a),
}));

const lensRun = vi.fn();
const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { get: (...a: unknown[]) => apiGet(...a) },
}));

import { ConKayWorkspace } from '@/components/conkay/workspace/ConKayWorkspace';

const DIMS = { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 };
const MATERIALS = [
  { id: 'steel-a992', label: 'ASTM A992 Steel (50 ksi)', category: 'metal', E: 200000, yield: 345, density: 7850 },
  { id: 'steel-a36', label: 'ASTM A36 Structural Steel', category: 'metal', E: 200000, yield: 250, density: 7850 },
];
function solved(over: Record<string, unknown> = {}) {
  return {
    jobId: 'sim_1', elapsedMs: 12, name: 'I-beam study', updatedAt: new Date().toISOString(),
    dims: DIMS, support: 'simply-supported', loadN: 200000, loadNode: 'N4',
    material: { id: 'steel-a992', label: 'ASTM A992 Steel (50 ksi)', E: 200000, yield: 345 },
    section: { areaMm2: 7086, IxMm4: 1.06e8, IyMm4: 8.4e6 },
    maxStressMPa: 86.1, maxDeflectionMm: 0.344, utilization: 0.249, safetyFactor: 4.01, pass: true,
    handCheck: { maxStressMPa: 86.1, maxDeflectionMm: 0.344, stressError: 0, deflectionError: 0, agrees: true, tolerance: 0.02 },
    warnings: [], utilizationByMember: [{ id: 'M1', utilization: 0.1 }, { id: 'M2', utilization: 0.249 }],
    ...over,
  };
}
const ok = (result: unknown) => ({ data: { ok: true, result, error: null } });

let appended: unknown[] = [];
function routes(extra: Record<string, (input: Record<string, unknown>) => unknown> = {}) {
  lensRun.mockImplementation(async (domain: string, action: string, input: Record<string, unknown>) => {
    const key = `${domain}.${action}`;
    if (extra[key]) return extra[key](input);
    switch (key) {
      case 'engineering.materialLibrary': return ok({ materials: MATERIALS });
      case 'engineering.beamStudy-get': return ok({ study: null });
      case 'engineering.workspaceLog-get': return ok({ messages: [] });
      case 'engineering.workspaceLog-append': appended.push(...(input.messages as unknown[])); return ok({ count: appended.length });
      case 'engineering.workspaceLog-clear': return ok({ cleared: 1 });
      case 'agent_projects.list': return ok({ projects: [{ id: 'proj_1', name: 'Industrial Frame' }] });
      case 'engineering.beamStudy': return ok(solved({ dims: { ...DIMS, ...(input.dims as object) }, loadN: input.loadN, support: input.support }));
      default: return ok({});
    }
  });
}

function send(text: string) {
  fireEvent.change(screen.getByLabelText('Message ConKay'), { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send'));
}
const convo = () => screen.getByLabelText('ConKay conversation');

beforeEach(() => {
  // jsdom has no layout: the conversation's auto-scroll needs a stub.
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  // A wide screen: the parameters card starts open.
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  search = '';
  appended = [];
  lensRun.mockReset();
  apiGet.mockReset();
  streamMock.mockReset();
  routerPush.mockReset();
  routerReplace.mockReset();
  routes();
});
afterEach(() => cleanup());

describe('ConKay workspace — before any solve', () => {
  it('shows editable inputs but no result, and offers Run FEA', async () => {
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    expect((screen.getByLabelText('t_w web thickness') as HTMLInputElement).value).toBe('9');
    expect(screen.queryByText(/FEA util\./)).toBeNull();
    expect(screen.queryByText(/Within yield/)).toBeNull();
    expect(screen.getByTestId('beam-viewport')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Industrial Frame' })).toBeTruthy();
  });
});

describe('ConKay workspace — study edits', () => {
  it('parses an edit, re-solves through engineering.beamStudy and replies with the solver numbers', async () => {
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    send("Let's reduce web thickness to 8.0 mm and re-run the FEA. Keep flanges at 15.0 mm.");
    await waitFor(() => expect(within(convo()).getByText(/Update applied: t_w = 8 mm\. FEA complete\. Max bending stress 86\.1 MPa/)).toBeTruthy());
    const call = lensRun.mock.calls.find((c) => c[0] === 'engineering' && c[1] === 'beamStudy');
    expect(call?.[2]).toMatchObject({ dims: { ...DIMS, webThickness: 8 }, material: 'steel-a992', support: 'simply-supported' });
    expect(screen.getByText('FEA util. 24.9%')).toBeTruthy();
    expect(screen.getByText('Hand check agrees')).toBeTruthy();
    expect(screen.queryByText(/confiden/i)).toBeNull();
    // Final messages are appended to the server log once.
    await waitFor(() => expect(appended.length).toBe(2));
  });

  it('hides results again when an input changes after the solve', async () => {
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    send('run fea');
    await waitFor(() => expect(screen.getByText('FEA util. 24.9%')).toBeTruthy());
    const tw = screen.getByLabelText('t_w web thickness') as HTMLInputElement;
    fireEvent.change(tw, { target: { value: '7' } });
    fireEvent.blur(tw);
    await waitFor(() => expect(screen.getByText(/Inputs changed since the last solve/)).toBeTruthy());
    expect(screen.queryByText('FEA util. 24.9%')).toBeNull();
  });

  it('says plainly when the solver refuses the inputs', async () => {
    routes({ 'engineering.beamStudy': () => ({ data: { ok: false, result: null, error: 'the two flanges are thicker than the beam is tall' } }) });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    send('t_f = 200');
    await waitFor(() => expect(within(convo()).getByText(/The solve did not run: the two flanges are thicker/)).toBeTruthy());
  });

  it('runs a parameter sweep and offers the lightest passing section', async () => {
    routes({
      'engineering.beamSweep': () => ok({
        jobId: 'sim_s', param: 'webThickness', elapsedMs: 40, lightestPassing: 6,
        rows: [6, 7, 8, 9, 10, 11, 12].map((v) => ({ value: v, ok: true, maxStressMPa: 100 - v, maxDeflectionMm: 0.3, utilization: 0.3, safetyFactor: 3, pass: true, handCheckAgrees: true, areaMm2: 6000 + v })),
      }),
    });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    send('run fea');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Parameter sweep' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Parameter sweep' }));
    await waitFor(() => expect(within(convo()).getByText(/lightest passing section is t_w = 6 mm/)).toBeTruthy());
    expect(within(convo()).getByText(/web shear, local and lateral-torsional buckling are not checked/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use t_w = 6 mm' }));
    await waitFor(() => expect(lensRun.mock.calls.filter((c) => c[1] === 'beamStudy').at(-1)?.[2]).toMatchObject({ dims: { webThickness: 6 } }));
  });

  it('keeps a solve as a DTU only after the read-back matches, then records it on the study', async () => {
    routes({
      'dtu.create': () => ok({ dtu: { id: 'dtu_k1' } }),
      'dtu.get': () => ok({ dtu: { id: 'dtu_k1' } }),
      'engineering.beamStudy-keep': () => ok({ jobId: 'sim_1', dtuId: 'dtu_k1' }),
    });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    send('run fea');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep as DTU' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Keep as DTU' }));
    await waitFor(() => expect(screen.getByText('Kept as DTU')).toBeTruthy());
    expect(screen.getByText('dtu_k1')).toBeTruthy();
    const create = lensRun.mock.calls.find((c) => c[0] === 'dtu' && c[1] === 'create');
    expect(create?.[2]).toMatchObject({ source: 'conkay-workspace:beam-study', machine: { jobId: 'sim_1', pass: true } });
    expect(lensRun.mock.calls.find((c) => c[1] === 'beamStudy-keep')?.[2]).toMatchObject({ jobId: 'sim_1', dtuId: 'dtu_k1' });
  });

  it('does not claim a DTU when the read-back fails', async () => {
    routes({ 'dtu.create': () => ok({ dtu: { id: 'dtu_k2' } }), 'dtu.get': () => ({ data: { ok: false, result: null, error: 'gone' } }) });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    send('run fea and keep as dtu');
    await waitFor(() => expect(within(convo()).getByText(/Not kept\. Saved as dtu_k2 but the read-back did not return it/)).toBeTruthy());
    expect(lensRun.mock.calls.some((c) => c[1] === 'beamStudy-keep')).toBe(false);
  });

  it('saves the model as an i-beam part in metres', async () => {
    routes({ 'engineering.savePart': (input) => ok({ part: { id: 'part_1', name: input.name } }) });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    send('save model');
    await waitFor(() => expect(within(convo()).getByText(/Saved “I-beam study” to Models \(part_1\)/)).toBeTruthy());
    expect(lensRun.mock.calls.find((c) => c[1] === 'savePart')?.[2]).toMatchObject({ kind: 'i-beam', params: { length: 1.2, webThickness: 0.009 } });
  });
});

describe('ConKay workspace — agent and reopen', () => {
  it('sends questions to the ConKay agent with the study as context and reloads after an agent solve', async () => {
    streamMock.mockImplementation(async (args: { persona: string; onToken: (c: string) => void; onToolCall: (c: unknown) => void }) => {
      expect(args.persona).toContain('Current inputs: L=1200 mm');
      args.onToolCall({ tool: 'run_lens_action', domain: 'engineering', action: 'beamStudy', ok: true });
      args.onToken('A deeper section raises I faster than c.');
      return { ok: true };
    });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    const before = lensRun.mock.calls.filter((c) => c[1] === 'beamStudy-get').length;
    send('why does a deeper section reduce the bending stress?');
    await waitFor(() => expect(within(convo()).getByText('A deeper section raises I faster than c.')).toBeTruthy());
    expect(within(convo()).getByText('ran engineering.beamStudy')).toBeTruthy();
    await waitFor(() => expect(lensRun.mock.calls.filter((c) => c[1] === 'beamStudy-get').length).toBe(before + 1));
  });

  it('says the language model is offline instead of inventing an answer', async () => {
    streamMock.mockResolvedValue({ ok: false, error: 'fetch failed' });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    send('what about buckling?');
    await waitFor(() => expect(within(convo()).getByText(/language model is not reachable right now/)).toBeTruthy());
  });

  it('reopens the stored study and conversation', async () => {
    routes({
      'engineering.beamStudy-get': () => ok({ study: {
        name: 'Frame beam', dims: { ...DIMS, webThickness: 8 }, support: 'cantilever', loadN: 5000, jobId: 'sim_9', dtuId: 'dtu_old',
        updatedAt: new Date().toISOString(), section: solved().section, utilizationByMember: [], loadNode: 'N8',
        summary: { maxStressMPa: 12.5, maxDeflectionMm: 0.2, utilization: 0.036, safetyFactor: 27.6, pass: true, handCheck: solved().handCheck, warnings: [] },
        materialInfo: solved().material,
      } }),
      'engineering.workspaceLog-get': () => ok({ messages: [{ id: 'old1', role: 'assistant', text: 'Earlier reply.', at: '2026-10-06T10:00:00.000Z' }] }),
    });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText('FEA util. 3.6%')).toBeTruthy());
    expect(screen.getByText('dtu_old')).toBeTruthy();
    expect(within(convo()).getByText('Earlier reply.')).toBeTruthy();
    expect((screen.getByLabelText('Study name') as HTMLInputElement).value).toBe('Frame beam');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(within(convo()).queryByText('Earlier reply.')).toBeNull());
    expect(appended).toEqual([]);
  });
});

describe('ConKay workspace — handoffs and navigation', () => {
  it('?ask= sends the request once and strips it from the URL', async () => {
    search = 'ask=t_w%20%3D%2010%20mm';
    render(<ConKayWorkspace />);
    await waitFor(() => expect(within(convo()).getByText(/Update applied: t_w = 10 mm/)).toBeTruthy());
    expect(routerReplace).toHaveBeenCalledWith('/lenses/conkay');
  });

  it('?dtu= opens a kept beam study DTU and loads its inputs without showing results', async () => {
    search = 'dtu=dtu_b1&title=Kept';
    routes({ 'dtu.get': () => ok({ dtu: { id: 'dtu_b1', title: 'Shop beam: 300×150', machine: {
      kind: 'conkay_beam_study', jobId: 'sim_7', dims: { ...DIMS, length: 3000 }, support: 'cantilever', loadN: 9000,
      material: 'steel-a36', maxStressMPa: 42.1, utilization: 0.17,
    } } }) });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(within(convo()).getByText(/Opened “Shop beam: 300×150”\. Its inputs are loaded/)).toBeTruthy());
    expect((screen.getByLabelText('L length') as HTMLInputElement).value).toBe('3000');
    expect(screen.queryByText(/FEA util\./)).toBeNull();
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('?dtu= for another DTU shows its stored summary, then asks ConKay', async () => {
    search = 'dtu=dtu_n1';
    streamMock.mockResolvedValue({ ok: false, error: 'fetch failed' });
    routes({ 'dtu.get': () => ok({ dtu: { id: 'dtu_n1', title: 'Site notes', human: { summary: 'Column grid 6 m.' } } }) });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(within(convo()).getByText(/Opened “Site notes”:/)).toBeTruthy());
    expect(within(convo()).getByText(/Column grid 6 m\./)).toBeTruthy();
    await waitFor(() => expect(streamMock).toHaveBeenCalled());
  });

  it('creates a workspace and switches to it', async () => {
    routes({ 'agent_projects.create': (input) => ok({ project: { id: 'proj_new', name: input.name } }) });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText('New workspace'));
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Launch Vehicle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/lenses/conkay?ws=proj_new'));
  });

  it('lists real stores in each nav section and says when they are empty', async () => {
    routes({
      'engineering.listParts': () => ok({ parts: [{ id: 'p1', name: 'Shop beam', kind: 'i-beam', params: { length: 2, height: 0.3, flangeWidth: 0.15, flangeThickness: 0.015, webThickness: 0.009 }, material: 'steel-a36', geometry: { mass: 70.6 } }] }),
      'engineering.listSimJobs': () => ok({ jobs: [{ id: 'sim_1', name: 'I-beam study', type: 'fea-beam-study', summary: { maxUtilization: 0.25, allPass: true }, elapsedMs: 9 }] }),
      'chat.projects-list': () => ok({ projects: [] }),
    });
    apiGet.mockResolvedValue({ data: { items: [{ id: 'dtu_v1', title: 'Vault item', tags: ['fea'] }] } });
    render(<ConKayWorkspace />);
    await waitFor(() => expect(screen.getByText(/Not solved yet/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Models' }));
    await waitFor(() => expect(screen.getByText('Shop beam')).toBeTruthy());
    expect(screen.getByText(/70\.6 kg/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect((screen.getByLabelText('L length') as HTMLInputElement).value).toBe('2000');

    fireEvent.click(screen.getByRole('button', { name: /Models/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Simulations' }));
    await waitFor(() => expect(screen.getByText(/Beam study · 25\.0% util\./)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Simulations/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    await waitFor(() => expect(screen.getByText(/No Chat projects yet/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Projects/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Data Vault' }));
    await waitFor(() => expect(screen.getByText('Vault item')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Data Vault/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    fireEvent.click(screen.getByRole('button', { name: /ASTM A36 Structural Steel/ }));
    expect((screen.getByLabelText('Material') as HTMLSelectElement).value).toBe('steel-a36');
  });
});
