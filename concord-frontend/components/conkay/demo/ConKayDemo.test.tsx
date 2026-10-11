import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="viewport" /> }));

import { ConKayDemo } from './ConKayDemo';

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

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/conkay/demo/materials')) return { status: 200, json: async () => ({ ok: true, materials: MATERIALS }) };
    if (url.startsWith('/api/conkay/demo/beam')) return { status: 200, json: async () => ({ ok: true, saved: false, result: RESULT }) };
    return { status: 404, json: async () => ({ ok: false, error: 'not found' }) };
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('ConKayDemo', () => {
  it('shows no result until the solver returns one', () => {
    render(<ConKayDemo />);
    expect(screen.getByText(/Not solved yet/)).toBeTruthy();
    expect(screen.queryByText(/FEA util\./)).toBeNull();
  });

  it('runs the FEA and shows the solver numbers', async () => {
    render(<ConKayDemo />);
    fireEvent.click(screen.getAllByRole('button', { name: /Run FEA/ })[0]);
    await waitFor(() => expect(screen.getByText('FEA util. 29.3%')).toBeTruthy());
    expect(screen.getByText('Hand check agrees')).toBeTruthy();
    expect(screen.getByText(/beam-frame-fea/)).toBeTruthy();
  });

  it('keeping a study sends the visitor to sign-up', async () => {
    render(<ConKayDemo />);
    fireEvent.click(screen.getAllByRole('button', { name: /Run FEA/ })[0]);
    const keep = await screen.findByRole('button', { name: 'Create an account to keep it' });
    fireEvent.click(keep);
    expect(push).toHaveBeenCalledWith('/register?from=%2Flenses%2Fconkay');
  });

  it('shows the solver error instead of a result', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/beam')
      ? { status: 400, json: async () => ({ ok: false, error: 'the web is wider than the flanges' }) }
      : { status: 200, json: async () => ({ ok: true, materials: MATERIALS }) })));
    render(<ConKayDemo />);
    fireEvent.click(screen.getAllByRole('button', { name: /Run FEA/ })[0]);
    expect(await screen.findByText('the web is wider than the flanges')).toBeTruthy();
    expect(screen.queryByText(/FEA util\./)).toBeNull();
  });
});

describe('ConKayDemo — server overload', () => {
  it('retries a 503 and says it is warming up, then shows the real result', async () => {
    let beamCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/materials')) return { status: 200, json: async () => ({ ok: true, materials: MATERIALS }) };
      beamCalls++;
      if (beamCalls === 1) {
        return { status: 503, json: async () => ({ ok: false, error: 'service_overloaded', code: 'service_warming', retryAfterS: 0, warming: true }) };
      }
      return { status: 200, json: async () => ({ ok: true, saved: false, result: RESULT }) };
    }));
    render(<ConKayDemo />);
    fireEvent.click(screen.getAllByRole('button', { name: /Run FEA/ })[0]);
    await waitFor(() => expect(screen.getByText('FEA util. 29.3%')).toBeTruthy());
    expect(beamCalls).toBe(2);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/service_overloaded/)).toBeNull();
  });

  it('shows the warming-up notice while the retry is pending', async () => {
    let release: () => void = () => {};
    let beamCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/materials')) return { status: 200, json: async () => ({ ok: true, materials: MATERIALS }) };
      beamCalls++;
      if (beamCalls === 1) return { status: 503, json: async () => ({ ok: false, code: 'service_warming', retryAfterS: 0 }) };
      await new Promise<void>((r) => { release = r; });
      return { status: 200, json: async () => ({ ok: true, saved: false, result: RESULT }) };
    }));
    render(<ConKayDemo />);
    fireEvent.click(screen.getAllByRole('button', { name: /Run FEA/ })[0]);

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
    render(<ConKayDemo />);
    fireEvent.click(screen.getAllByRole('button', { name: /Run FEA/ })[0]);
    expect(await screen.findByText('ConKay is busy right now. Try again in a few seconds.')).toBeTruthy();
    expect(beamCalls).toBe(4);
    expect(screen.queryByText(/FEA util\./)).toBeNull();
  });
});
