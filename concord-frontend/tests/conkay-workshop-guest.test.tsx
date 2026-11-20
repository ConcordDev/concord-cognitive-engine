// ConKay Workshop — guest mode (/conkay/demo, and any signed-out visit).
// The same workshop, solving and sweeping through the public demo routes;
// nothing is read from or written to an account store; keeping points to
// sign-up; a real 503 is retried with a visible notice, never a fake result.
// (Ported from the retired ConKayDemo page's test — same guarantees.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const routerPush = vi.fn();
const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  usePathname: () => '/conkay/demo',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="viewport" /> }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('next/font/google', () => ({ Chakra_Petch: () => ({ variable: 'ws-font', className: 'ws-font' }) }));
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
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { get: vi.fn(), post: vi.fn() },
  apiHelpers: { lens: { list: vi.fn(async () => ({ data: { items: [] } })) } },
}));

import { Workshop } from '@/components/conkay/workshop/Workshop';

const MATERIALS = [{ id: 'steel-a992', label: 'ASTM A992 Steel (50 ksi)', category: 'metal', E: 200000, yield: 345, density: 7850 }];
const RESULT = {
  elapsedMs: 3,
  dims: { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 },
  support: 'simply-supported', loadN: 200000, loadNode: 'N4',
  material: { id: 'steel-a992', label: 'ASTM A992 Steel (50 ksi)', E: 200000, yield: 345 },
  section: { areaMm2: 7000, IxMm4: 1e8, IyMm4: 1e7 },
  maxStressMPa: 101.2, maxDeflectionMm: 0.42, utilization: 0.293, safetyFactor: 3.41, pass: true,
  handCheck: { maxStressMPa: 101.2, maxDeflectionMm: 0.42, stressError: 0, deflectionError: 0, agrees: true, tolerance: 0.02 },
  warnings: [], utilizationByMember: [{ id: 'M1', utilization: 0.29 }],
  analysisReceipt: { solver: 'beam-frame-fea', inputHash: 'abcdef0123456789', units: 'SI', assumptions: [], outOfScope: [] },
};
const SWEEP = { param: 'webThickness', elapsedMs: 9, lightestPassing: 6, rows: [6, 7, 8, 9].map((v) => ({ value: v, ok: true, maxStressMPa: 120 - v, maxDeflectionMm: 0.5, utilization: 0.4, safetyFactor: 2.5, pass: true })) };

function okFetch() {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/conkay/demo/materials')) return { status: 200, json: async () => ({ ok: true, materials: MATERIALS }) };
    if (url.startsWith('/api/conkay/demo/beam')) return { status: 200, json: async () => ({ ok: true, saved: false, result: RESULT }) };
    if (url.startsWith('/api/conkay/demo/sweep')) return { status: 200, json: async () => ({ ok: true, result: SWEEP }) };
    if (url.startsWith('/api/conkay/demo/designs')) return { status: 200, json: async () => ({ ok: true, designs: [] }) };
    return { status: 404, json: async () => ({ ok: false, error: 'not found' }) };
  });
}

const runFea = () => fireEvent.click(screen.getAllByRole('button', { name: /Run FEA/ })[0]);

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  routerPush.mockReset(); routerReplace.mockReset(); lensRun.mockReset(); streamMock.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  vi.stubGlobal('fetch', okFetch());
});
afterEach(() => { vi.unstubAllGlobals(); cleanup(); });

describe('Workshop — guest', () => {
  it('opens on the start screen, shows no result, and touches no account store', async () => {
    render(<Workshop guest />);
    expect(await screen.findByText('What do you want to build?')).toBeTruthy();
    expect(screen.queryByText(/FEA util\./)).toBeNull();
    expect(screen.getByText(/Nothing is saved/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('runs the FEA through the public route and shows the solver numbers', async () => {
    render(<Workshop guest />);
    runFea();
    await waitFor(() => expect(screen.getByText('FEA util. 29.3%')).toBeTruthy());
    expect(screen.getByText('Hand check agrees')).toBeTruthy();
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('"make it lighter" sweeps through the public route and offers the lightest section', async () => {
    render(<Workshop guest />);
    fireEvent.change(screen.getByLabelText('Message ConKay'), { target: { value: 'make it lighter' } });
    fireEvent.click(screen.getByLabelText('Send'));
    expect(await screen.findByText(/lightest passing section is t_w = 6 mm/)).toBeTruthy();
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('keeping a study sends the visitor to sign-up', async () => {
    render(<Workshop guest />);
    runFea();
    const keep = await screen.findByRole('button', { name: 'Create an account to keep it' });
    fireEvent.click(keep);
    expect(routerPush).toHaveBeenCalledWith('/register?from=%2Flenses%2Fconkay');
  });

  it('a question for Kay says it needs an account instead of calling the agent', async () => {
    render(<Workshop guest />);
    fireEvent.change(screen.getByLabelText('Message ConKay'), { target: { value: 'why do I-beams have flanges?' } });
    fireEvent.click(screen.getByLabelText('Send'));
    expect(await screen.findByText(/needs an account/)).toBeTruthy();
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('shows the solver error instead of a result', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/beam')
      ? { status: 400, json: async () => ({ ok: false, error: 'the web is wider than the flanges' }) }
      : { status: 200, json: async () => ({ ok: true, materials: MATERIALS }) })));
    render(<Workshop guest />);
    runFea();
    expect((await screen.findAllByText(/the web is wider than the flanges/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/FEA util\./)).toBeNull();
  });
});

describe('Workshop — guest, server overload', () => {
  it('retries a 503 with a visible notice, then shows the real result', async () => {
    let release: () => void = () => {};
    let beamCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/materials')) return { status: 200, json: async () => ({ ok: true, materials: MATERIALS }) };
      beamCalls++;
      if (beamCalls === 1) return { status: 503, json: async () => ({ ok: false, code: 'service_warming', retryAfterS: 0 }) };
      await new Promise<void>((r) => { release = r; });
      return { status: 200, json: async () => ({ ok: true, saved: false, result: RESULT }) };
    }));
    render(<Workshop guest />);
    runFea();
    expect(await screen.findByText(/ConKay is warming up after a restart\. Retrying \(2 of 4\)/)).toBeTruthy();
    release();
    await waitFor(() => expect(screen.getByText('FEA util. 29.3%')).toBeTruthy());
    expect(screen.queryByText(/warming up/)).toBeNull();
  });

  it('gives up after four attempts with a plain message, never a fake result', async () => {
    let beamCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/materials')) return { status: 200, json: async () => ({ ok: true, materials: MATERIALS }) };
      beamCalls++;
      return { status: 503, json: async () => ({ ok: false, error: 'service_overloaded', code: 'service_overloaded', retryAfterS: 0 }) };
    }));
    render(<Workshop guest />);
    runFea();
    expect((await screen.findAllByText('ConKay is busy right now. Try again in a few seconds.')).length).toBeGreaterThan(0);
    expect(beamCalls).toBe(4);
    expect(screen.queryByText(/FEA util\./)).toBeNull();
  });
});
