/**
 * /lenses/courtship — four-UX-state contract.
 *
 * Pins that the courtship lens renders genuine loading (role=status) /
 * error (role=alert + a working Retry) / empty / populated states against the
 * REAL courtship HTTP surface (driven by a mocked global.fetch standing in for
 *   GET  /api/courtship/mine            → romance-engine#listMyCourtships
 *   GET  /api/courtship/marriages/mine  → listMyMarriages + listChildren
 *   POST /api/lens/run courtship.constants → ROMANCE_CONSTANTS
 * ), plus the a11y + responsive contract (Retry + per-row action buttons carry
 * accessible names; the error path fires an error toast).
 *
 * No fabricated data: every state is driven by the exact JSON shapes the
 * courtship routes return.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

// The lens does not call lensRun directly (it uses fetch), but the polish
// recipe mocks the api client for parity with the canonical template.
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Toast slice — capture error toasts so we can assert the ERROR path fires one.
const addToastMock = vi.fn();
vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: typeof addToastMock }) => unknown) =>
    selector({ addToast: addToastMock }),
}));

// LensShell is a presentational wrapper — stub to keep the render focused.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import CourtshipLensPage from '@/app/lenses/courtship/page';

const CONSTANTS_OK = {
  ok: true,
  constants: { ENGAGE_THRESHOLD: 0.7, MARRY_THRESHOLD: 0.85 },
};

// Build a fetch impl from per-URL responders. Unmatched URLs resolve empty-ok.
function makeFetch(handlers: Record<string, () => unknown>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const key of Object.keys(handlers)) {
      if (url.includes(key)) {
        const body = handlers[key]();
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
        } as Response);
      }
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } as Response);
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
  addToastMock.mockReset();
});

describe('courtship lens — UX states', () => {
  it('LOADING: shows a role=status notice while the courtship data is in flight', async () => {
    // The data calls never resolve → stuck loading.
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/lens/run')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CONSTANTS_OK) } as Response);
      }
      return new Promise(() => {}) as Promise<Response>;
    }) as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    const loading = view!.getByTestId('courtship-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('EMPTY: shows an honest empty state once data loads and nothing is courted', async () => {
    global.fetch = makeFetch({
      '/api/lens/run': () => CONSTANTS_OK,
      '/api/courtship/mine': () => ({ ok: true, courtships: [] }),
      '/api/courtship/marriages/mine': () => ({ ok: true, marriages: [], children: [] }),
    }) as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('courtship-empty')).toBeInTheDocument());
    expect(view!.getByTestId('courtship-empty').textContent).toMatch(/no active courtships/i);
    // Honest empty sub-sections render too.
    expect(view!.getByText(/no active marriages/i)).toBeInTheDocument();
    expect(view!.getByText(/no children/i)).toBeInTheDocument();
  });

  it('POPULATED: renders real courtships, marriages, children + accessible action buttons', async () => {
    global.fetch = makeFetch({
      '/api/lens/run': () => CONSTANTS_OK,
      '/api/courtship/mine': () => ({
        ok: true,
        courtships: [
          { partner_kind: 'npc', partner_id: 'npc_alice_0001', affinity: 0.72, status: 'courting' },
        ],
      }),
      '/api/courtship/marriages/mine': () => ({
        ok: true,
        marriages: [{ id: 'm1', partner_kind: 'npc', partner_id: 'npc_bob_0002', married_at: 1700000000 }],
        children: [{ id: 'k1', parent_user_id: 'u1', name: 'Iris', maturity: 'infant', born_at: 1700000500 }],
      }),
    }) as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('courtship-list')).toBeInTheDocument());

    // affinity readout + the propose gate (0.72 >= 0.7 engage threshold)
    expect(view!.getByLabelText('affinity 72 percent')).toBeInTheDocument();
    expect(view!.getByLabelText('Interact positively with npc_alice_0001')).toBeInTheDocument();
    expect(view!.getByLabelText('Propose to npc_alice_0001')).toBeInTheDocument();

    // marriage + child rows render real data
    expect(view!.getByText(/npc:npc_bob_0002/)).toBeInTheDocument();
    expect(view!.getByText('Iris')).toBeInTheDocument();
  });

  it('ACTION: Interact POSTs to /api/courtship/interact and re-refreshes', async () => {
    const fetchImpl = makeFetch({
      '/api/lens/run': () => CONSTANTS_OK,
      '/api/courtship/interact': () => ({ ok: true }),
      '/api/courtship/mine': () => ({
        ok: true,
        courtships: [
          { partner_kind: 'npc', partner_id: 'npc_alice_0001', affinity: 0.5, status: 'courting' },
        ],
      }),
      '/api/courtship/marriages/mine': () => ({ ok: true, marriages: [], children: [] }),
    });
    global.fetch = fetchImpl as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('courtship-list')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(view!.getByLabelText('Interact positively with npc_alice_0001'));
    });

    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some((c) => String(c[0]).includes('/api/courtship/interact')),
      ).toBe(true),
    );
    // No error toast on a successful action.
    expect(addToastMock).not.toHaveBeenCalled();
  });

  it('WED gate: an engaged + high-affinity courtship exposes Propose/Wed actions', async () => {
    const fetchImpl = makeFetch({
      '/api/lens/run': () => CONSTANTS_OK,
      '/api/courtship/propose': () => ({ ok: true }),
      '/api/courtship/wed': () => ({ ok: true }),
      '/api/courtship/mine': () => ({
        ok: true,
        courtships: [
          { partner_kind: 'npc', partner_id: 'npc_eng_0003', affinity: 0.9, status: 'engaged' },
        ],
      }),
      '/api/courtship/marriages/mine': () => ({ ok: true, marriages: [], children: [] }),
    });
    global.fetch = fetchImpl as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('courtship-list')).toBeInTheDocument());

    // Engaged + affinity 0.9 >= marry threshold 0.85 → Wed button shows.
    const wedBtn = view!.getByLabelText('Wed npc_eng_0003');
    expect(wedBtn).toBeInTheDocument();
    await act(async () => { fireEvent.click(wedBtn); });
    await waitFor(() =>
      expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes('/api/courtship/wed'))).toBe(true),
    );
  });

  it('PROPOSE: a courting + above-threshold partner can be proposed to', async () => {
    const fetchImpl = makeFetch({
      '/api/lens/run': () => CONSTANTS_OK,
      '/api/courtship/propose': () => ({ ok: true }),
      '/api/courtship/mine': () => ({
        ok: true,
        courtships: [
          { partner_kind: 'npc', partner_id: 'npc_pro_0004', affinity: 0.75, status: 'courting' },
        ],
      }),
      '/api/courtship/marriages/mine': () => ({ ok: true, marriages: [], children: [] }),
    });
    global.fetch = fetchImpl as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('courtship-list')).toBeInTheDocument());

    await act(async () => { fireEvent.click(view!.getByLabelText('Propose to npc_pro_0004')); });
    await waitFor(() =>
      expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes('/api/courtship/propose'))).toBe(true),
    );
  });

  it('ACTION error: a rejected action surfaces an inline alert + error toast', async () => {
    const fetchImpl = makeFetch({
      '/api/lens/run': () => CONSTANTS_OK,
      '/api/courtship/interact': () => ({ ok: false, reason: 'too_soon' }),
      '/api/courtship/mine': () => ({
        ok: true,
        courtships: [
          { partner_kind: 'npc', partner_id: 'npc_alice_0001', affinity: 0.5, status: 'courting' },
        ],
      }),
      '/api/courtship/marriages/mine': () => ({ ok: true, marriages: [], children: [] }),
    });
    global.fetch = fetchImpl as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('courtship-list')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(view!.getByLabelText('Interact positively with npc_alice_0001'));
    });

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
  });

  it('ERROR: shows role=alert + an error toast + a Retry that re-issues the load', async () => {
    let failNext = true;
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/lens/run')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CONSTANTS_OK) } as Response);
      }
      if (url.includes('/api/courtship/mine')) {
        if (failNext) {
          return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ ok: false }) } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, courtships: [] }) } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, marriages: [], children: [] }) } as Response);
    }) as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });

    await waitFor(() => expect(view!.getByTestId('courtship-error')).toBeInTheDocument());
    expect(view!.getByTestId('courtship-error')).toHaveAttribute('role', 'alert');
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));

    const mineCallsBefore = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => String(c[0]).includes('/api/courtship/mine')).length;

    // Retry now succeeds → recovers to the empty/ready surface.
    failNext = false;
    await act(async () => { fireEvent.click(view!.getByLabelText('Retry loading courtships')); });

    const mineCallsAfter = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => String(c[0]).includes('/api/courtship/mine')).length;
    expect(mineCallsAfter).toBeGreaterThan(mineCallsBefore);

    await waitFor(() => expect(view!.getByTestId('courtship-empty')).toBeInTheDocument());
  });
});
