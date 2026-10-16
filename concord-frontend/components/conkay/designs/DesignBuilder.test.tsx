import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

vi.mock('next/dynamic', () => ({
  default: () => (props: { url?: string }) => <div data-testid="stl-viewer" data-url={props.url ?? ''} />,
}));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const { replaceSpy } = vi.hoisted(() => ({ replaceSpy: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: replaceSpy }) }));

import { DesignBuilder } from './DesignBuilder';
import type { DesignSnapshot } from '@/lib/conkay/designs-api';
import type { LiveEvent } from '@/lib/conkay/live-api';
import type { WorkbenchReply, WorkbenchView } from '@/lib/conkay/workbench-api';
import { api } from '@/lib/api/client';

const MEANING = { sourced: 's', measured: 'm', computed: 'c', estimated: 'e', design: 'd', unknown: 'u' };
const SNAP: DesignSnapshot = {
  showcaseVersion: '1.0.0', id: 'car', title: 'Four-seat 180 mph car', kind: 'vehicle', pipeline: 'carAcceptanceAsync',
  brief: 'Design a car', headline: { verdict: 'credible_with_caveats', status: 'WARN' },
  disclaimers: ['Software screening only.'], caveats: ['Cd is a screening range'], failures: [],
  checks: [
    { runId: 'vehicle.top-speed@VEH', solver: 'vehicle.top-speed', target: 'VEH', status: 'PASS', method: 'power balance', reason: null, margins: [{ check: 'speed', demand: 80.5, capacity: 81.9, unit: 'm/s', utilization: 0.98, marginPct: 1.7 }], failures: [], warnings: [] },
    { runId: 'aero.drag-buildup@VEH', solver: 'aero.drag-buildup', target: 'VEH', status: 'WARN', method: null, reason: 'screening range wide', margins: [], failures: [], warnings: [] },
  ],
  checkCounts: { PASS: 1, WARN: 1, FAIL: 0, NOT_COMPUTED: 0, ERROR: 0 },
  perPartRuns: { PASS: 68, WARN: 0, FAIL: 0, NOT_COMPUTED: 0, ERROR: 0 },
  values: [
    { id: 'a', group: 'Component masses', name: 'ENGINE', value: 201.8, unit: 'kg', range: null, status: 'sourced', statusLabel: 'sourced', source: { title: 'Ford data sheet', url: 'https://example.org/ford' }, sourceRole: 'evidence', method: null, note: null },
  ],
  mass: { totalKg: 1032.2, bandKg: [1018, 1035], byState: { sourced: 361.2, measured: 213.2, computed: 305, estimated: 152.7, design: 0, unknown: 0 }, unknownCount: 0, notIncluded: ['fuel load'], note: 'lower bound', limit: { label: 'brief: 2,500 lb', kg: 1134, marginKg: 101.8 } },
  drawings: [{ title: 'General arrangement CK-GA-VEH', revision: 'R-77BE7CCC', modelHash: 'abc123', method: null, files: [
    { label: 'Sheet 1', name: 'CK-GA-VEH-sheet1.svg', kind: 'svg', bytes: 353236, sha256: 'x' },
  ] }],
  model3d: { name: 'body.stl', format: 'stl', bytes: 715384, sha256: 'z', triangles: 14306, units: 'm', upAxis: 'z', source: 'cad.body@BODY_SHELL' },
  physicalTests: ['Weigh the built car'], statuses: ['sourced', 'measured', 'computed', 'estimated', 'design', 'unknown'], statusMeaning: MEANING,
  files: [], snapshotSha256: 'f'.repeat(64),
};

const SOLVER = { id: 'requirement.check', version: '1.0.0', fidelity: 'L0', method: 'compare a solver output with the requirement bound', reference: null, regime: null, units: null, tolerance: null, screening: null };
const VIEW: WorkbenchView = {
  version: '1.0.0', revision: 0, receipt: 'd8c7cc281e676b5024c3', state: { fuelType: 'electric' }, locked: [],
  knobs: [
    { variable: 'tailExtensionM', label: 'Tail length', value: 0.22, unit: 'm', bounds: [0, 1], step: 0.1, locked: false, source: 'repair table' },
  ],
  graph: {
    nodes: [
      { id: 'knob:tailExtensionM', kind: 'knob', label: 'Tail length', depth: 0 },
      { id: 'requirement.check@REQ_topSpeed', kind: 'run', label: 'requirement.check@REQ_topSpeed', status: 'PASS', depth: 1 },
    ],
    edges: [{ from: 'knob:tailExtensionM', to: 'requirement.check@REQ_topSpeed', kind: 'reads' }],
  },
  checks: [{
    runId: 'requirement.check@REQ_topSpeed', status: 'PASS', solver: SOLVER,
    inputHash: 'abc123', inputs: {}, margins: [{ check: 'go 180 mph', demand: 80.4672, capacity: 81.94, unit: 'm/s', utilization: 0.982 }],
    warnings: [], failures: [], assumptions: [], sources: [], explanation: 'holds',
  }],
};

const ASK_REPLY: WorkbenchReply = {
  kind: 'requirement', ok: true,
  diff: {
    changed: [{ field: 'topSpeed', before: 80.47, after: 67.06, source: 'the user\'s words "150 mph"' }],
    flipped: [{ runId: 'requirement.check@REQ_topSpeed', from: 'FAIL', to: 'PASS' }],
    rerun: 'rebuilt',
  },
};
const ASK_VIEW: WorkbenchView = {
  ...VIEW, revision: 2,
  checks: [
    VIEW.checks[0],
    { runId: 'aero.drag-buildup@VEH', status: 'FAIL', solver: SOLVER, inputHash: 'd4', inputs: {}, margins: [], warnings: [], failures: [], assumptions: [], sources: [], explanation: 'fails' },
  ],
};

/** The recorded electric-car run, trimmed to what the builder reads (LiveBuild.test has the full one). */
const LIVE_EVENTS: LiveEvent[] = [
  { id: 1, type: 'start', initialState: { brief: 'Design a car that can go 180 mph, seats 4 people.' } },
  { id: 2, type: 'evaluated', failingChecks: ['requirement.check@REQ_topSpeed'], envelopes: { PASS: 137, FAIL: 4 }, snapshot: { kind: 'stl', file: '9887766c0116.stl', sha256: '9887766c0116f602', triangles: 15546 } },
];

class MockEventSource {
  static last: MockEventSource | null = null;
  url: string; readyState = 0; closed = false; onerror: (() => void) | null = null;
  listeners = new Map<string, ((m: { data: string }) => void)[]>();
  constructor(url: string) { this.url = url; MockEventSource.last = this; }
  addEventListener(t: string, fn: (m: { data: string }) => void) { this.listeners.set(t, [...(this.listeners.get(t) || []), fn]); }
  emit(e: LiveEvent) { for (const fn of this.listeners.get(e.type) || []) fn({ data: JSON.stringify(e) }); }
  close() { this.closed = true; this.readyState = 2; }
}

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPost = api.post as unknown as ReturnType<typeof vi.fn>;
type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

/** The showcase snapshot for /api/conkay/demo/designs/car; 404 for anything else (getDemoJson retries only on 503). */
function stubDesignFetch(designUrl = '/api/conkay/demo/designs/car') {
  fetchMock = vi.fn(async (url: string) => {
    if (url === designUrl) return { status: 200, json: async () => ({ ok: true, design: SNAP }) };
    return { status: 404, json: async () => ({ ok: false, error: 'no such showcase design' }) };
  });
  vi.stubGlobal('fetch', fetchMock);
}

const submitChat = async (value: string) => {
  const input = screen.getByLabelText('Message ConKay');
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form')!);
};

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/conkay/designs/car');
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  MockEventSource.last = null;
});

describe('DesignBuilder', () => {
  it('renders the snapshot beside the chat, with no live section when there is no run', async () => {
    stubDesignFetch();
    render(<DesignBuilder id="car" />);
    await screen.findByRole('heading', { name: 'Four-seat 180 mph car' });
    expect(screen.getByRole('note').textContent).toContain('Software screening only.');
    const img = screen.getByRole('img', { name: /General arrangement CK-GA-VEH, Sheet 1/ });
    expect(img.getAttribute('src')).toBe('/api/conkay/demo/designs/car/files/CK-GA-VEH-sheet1.svg');
    expect(screen.getByRole('button', { name: /vehicle\.top-speed@VEH/ })).toBeTruthy();
    expect(screen.getByLabelText('Message ConKay')).toBeTruthy();
    expect(screen.queryByTestId('builder-workbench-toggle')).toBeNull();
    // no live run for this design: the stream reports missing and the section hides quietly
    await waitFor(() => expect(screen.queryByTestId('live-conn')).toBeNull());
    expect(screen.queryByTestId('builder-live-body')).toBeNull();
  });

  it('the first chat message starts a session, keeps it in ?wb=, and the Workbench panel opens on demand', async () => {
    stubDesignFetch();
    apiPost.mockResolvedValue({ data: { id: 'w-123', view: VIEW } });
    render(<DesignBuilder id="car" />);
    await screen.findByRole('heading', { name: 'Four-seat 180 mph car' });
    await submitChat('make it faster');
    expect(apiPost).toHaveBeenCalledWith('/api/conkay/workbench', { prompt: 'Design a car\n\nmake it faster' });
    expect(replaceSpy).toHaveBeenCalledWith('/conkay/designs/car?wb=w-123');
    const msg = await screen.findByTestId('builder-msg-conkay');
    expect(msg.textContent).toMatch(/Workbench session started/);
    expect(within(msg).getByTestId('builder-checks').textContent).toMatch(/PASS 1/);
    expect(within(msg).getByTestId('builder-checks').textContent).toMatch(/go 180 mph util 0\.982/);
    const toggle = screen.getByTestId('builder-workbench-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('workbench')).toBeTruthy();
    expect(screen.getByTestId('wb-revision').textContent).toBe('0');
  });

  it('with ?wb= in the URL, a send goes to ask and shows the pass/fail counts from the returned view', async () => {
    stubDesignFetch();
    window.history.replaceState({}, '', '/conkay/designs/car?wb=w1');
    apiGet.mockResolvedValue({ data: { view: VIEW } });
    apiPost.mockImplementation(async (url: string) => {
      if (url === '/api/conkay/workbench/w1/ask') return { data: { reply: ASK_REPLY, view: ASK_VIEW } };
      throw new Error('unexpected POST ' + url);
    });
    render(<DesignBuilder id="car" />);
    await screen.findByTestId('builder-session');
    await submitChat('make the tail shorter');
    expect(apiPost).toHaveBeenCalledWith('/api/conkay/workbench/w1/ask', { text: 'make the tail shorter' });
    const msgs = await waitFor(() => {
      const all = screen.getAllByTestId('builder-msg-conkay');
      expect(all.length).toBeGreaterThan(0);
      return all;
    });
    const last = msgs[msgs.length - 1];
    expect(last.textContent).toMatch(/topSpeed: 80\.47 → 67\.06/);
    expect(last.textContent).toMatch(/requirement\.check@REQ_topSpeed: FAIL → PASS/);
    const checks = within(last).getByTestId('builder-checks');
    expect(checks.textContent).toMatch(/PASS 1 · FAIL 1/);
    expect(checks.textContent).toMatch(/go 180 mph util 0\.982/);
    expect(checks.textContent).toMatch(/aero\.drag-buildup@VEH · margins not computed/);
    // the Workbench panel is kept on the same revision the chat just reached
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/conkay/workbench/w1'));
    expect(apiGet.mock.calls.length).toBe(2); // once on load, once after the ask
  });

  it('a workbench UUID that is not a showcase id still opens here as a live session', async () => {
    stubDesignFetch(); // 404s for /api/conkay/demo/designs/wb-only-1
    apiGet.mockResolvedValue({ data: { view: VIEW } });
    render(<DesignBuilder id="wb-only-1" />);
    await screen.findByRole('heading', { name: 'Workbench session' });
    expect(screen.queryByRole('heading', { name: 'Four-seat 180 mph car' })).toBeNull();
    expect(screen.getByLabelText('Message ConKay')).toBeTruthy();
    expect(screen.getByTestId('builder-session').textContent).toBe('wb-only-');
    await waitFor(() => expect(screen.queryByTestId('live-conn')).toBeNull()); // no live run for a session id
  });

  it('the questions stage shows the questions instead of starting a session', async () => {
    stubDesignFetch();
    apiPost.mockResolvedValue({ data: { stage: 'questions', questions: [{ field: 'seats', question: 'How many seats must it hold?' }] } });
    render(<DesignBuilder id="car" />);
    await screen.findByRole('heading', { name: 'Four-seat 180 mph car' });
    await submitChat('a fast car');
    const msg = await screen.findByTestId('builder-msg-conkay');
    expect(msg.textContent).toMatch(/ConKay needs these first:/);
    expect(msg.textContent).toMatch(/How many seats must it hold\?/);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('builder-workbench-toggle')).toBeNull();
  });

  it('a live run streams into the page and its body snapshot takes the main viewer', async () => {
    stubDesignFetch();
    (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
    render(<DesignBuilder id="car" />);
    await screen.findByRole('heading', { name: 'Four-seat 180 mph car' }); // the stream mounts with the snapshot
    const es = MockEventSource.last!;
    expect(es.url).toBe('/api/conkay/demo/designs/car/live');
    act(() => { for (const e of LIVE_EVENTS) es.emit(e); });
    expect(screen.getByTestId('live-conn').textContent).toMatch(/Live/);
    expect(screen.getByTestId('live-brief').textContent).toMatch(/180 mph/);
    expect(screen.getByTestId('live-step-2')).toBeTruthy();
    const liveBody = screen.getByRole('region', { name: 'Live body' });
    expect(within(liveBody).getByTestId('stl-viewer').getAttribute('data-url')).toBe('/api/conkay/demo/designs/car/live/files/9887766c0116.stl');
    expect(screen.getByTestId('builder-live-body').textContent).toMatch(/15546 triangles/);
  });
});