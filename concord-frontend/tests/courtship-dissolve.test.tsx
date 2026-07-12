/**
 * /lenses/courtship — "End Marriage" (courtship.dissolve) action.
 *
 * Pins the real, designed dissolve flow added for the Frontend Rebuild
 * Program Wave 4 gap-closure (docs/lens-specs/courtship-capability-map.md):
 * a confirm-then-commit modal gates the irreversible action, the confirm
 * step calls POST /api/lens/run { domain:'courtship', name:'dissolve' },
 * cancel never calls it, and a successful dissolve removes the marriage
 * from the active list (and, when the backend returns it, surfaces it in
 * the "Past marriages" section sourced from courtship.marriages
 * {activeOnly:false}).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const addToastMock = vi.fn();
vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: typeof addToastMock }) => unknown) =>
    selector({ addToast: addToastMock }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import CourtshipLensPage from '@/app/lenses/courtship/page';

const CONSTANTS_OK = {
  ok: true,
  constants: { ENGAGE_THRESHOLD: 0.7, MARRY_THRESHOLD: 0.85 },
};

const ACTIVE_MARRIAGE = {
  id: 'marriage_abc123',
  partner_kind: 'npc',
  partner_id: 'npc_kel_999',
  married_at: 1700000000,
};

interface LensRunState {
  dissolved: boolean;
}

/**
 * A fetch mock that understands the shape of every call this page makes:
 * GET /api/courtship/mine, GET /api/courtship/marriages/mine, and the
 * multiplexed POST /api/lens/run (constants / dissolve / marriages).
 */
function makeCourtshipFetch(state: LensRunState) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });

    if (url.includes('/api/lens/run')) {
      const { domain, name, input: macroInput } = (body || {}) as {
        domain?: string; name?: string; input?: Record<string, unknown>;
      };
      if (domain === 'courtship' && name === 'constants') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CONSTANTS_OK) } as Response);
      }
      if (domain === 'courtship' && name === 'dissolve') {
        state.dissolved = true;
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ ok: true, result: { ok: true, dissolvedReason: 'estranged', courtStatus: 'estranged' } }),
        } as Response);
      }
      if (domain === 'courtship' && name === 'marriages') {
        const activeOnly = macroInput?.activeOnly !== false;
        const marriages = activeOnly
          ? (state.dissolved ? [] : [ACTIVE_MARRIAGE])
          : (state.dissolved
              ? [{ ...ACTIVE_MARRIAGE, dissolved_at: 1700005000, dissolved_reason: 'estranged' }]
              : [ACTIVE_MARRIAGE]);
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ ok: true, result: { ok: true, marriages } }),
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } as Response);
    }

    if (url.includes('/api/courtship/mine')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, courtships: [] }) } as Response);
    }
    if (url.includes('/api/courtship/marriages/mine')) {
      const marriages = state.dissolved ? [] : [ACTIVE_MARRIAGE];
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true, marriages, children: [] }),
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } as Response);
  });
  return { fn, calls };
}

beforeEach(() => {
  addToastMock.mockReset();
});

describe('courtship lens — End Marriage (courtship.dissolve)', () => {
  it('renders an "End Marriage" action for an active marriage', async () => {
    const state: LensRunState = { dissolved: false };
    const { fn } = makeCourtshipFetch(state);
    global.fetch = fn as unknown as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('marriage-list')).toBeInTheDocument());

    expect(view!.getByLabelText('End marriage to npc_kel_999')).toBeInTheDocument();
  });

  it('clicking "End Marriage" opens a real confirm modal without calling dissolve yet', async () => {
    const state: LensRunState = { dissolved: false };
    const { fn, calls } = makeCourtshipFetch(state);
    global.fetch = fn as unknown as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('marriage-list')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(view!.getByLabelText('End marriage to npc_kel_999'));
    });

    expect(view!.getByTestId('dissolve-confirm-modal')).toBeInTheDocument();
    expect(view!.getByRole('dialog')).toBeInTheDocument();
    // No dissolve call fired just from opening the confirm step.
    expect(calls.some((c) => c.body?.name === 'dissolve')).toBe(false);
  });

  it('Cancel closes the modal and never calls courtship.dissolve', async () => {
    const state: LensRunState = { dissolved: false };
    const { fn, calls } = makeCourtshipFetch(state);
    global.fetch = fn as unknown as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('marriage-list')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(view!.getByLabelText('End marriage to npc_kel_999'));
    });
    expect(view!.getByTestId('dissolve-confirm-modal')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(view!.getByLabelText('Cancel'));
    });

    expect(view!.queryByTestId('dissolve-confirm-modal')).not.toBeInTheDocument();
    expect(calls.some((c) => c.body?.name === 'dissolve')).toBe(false);
    // The marriage is untouched.
    expect(view!.getByLabelText('End marriage to npc_kel_999')).toBeInTheDocument();
  });

  it('confirming calls courtship.dissolve and removes the marriage from the active list', async () => {
    const state: LensRunState = { dissolved: false };
    const { fn, calls } = makeCourtshipFetch(state);
    global.fetch = fn as unknown as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('marriage-list')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(view!.getByLabelText('End marriage to npc_kel_999'));
    });
    await act(async () => {
      fireEvent.click(view!.getByLabelText('Confirm end marriage to npc:npc_kel_999'));
    });

    await waitFor(() => {
      expect(calls.some((c) => c.body?.domain === 'courtship' && c.body?.name === 'dissolve')).toBe(true);
    });
    const dissolveCall = calls.find((c) => c.body?.name === 'dissolve');
    expect((dissolveCall!.body as { input: { marriageId: string } }).input.marriageId).toBe('marriage_abc123');

    // Modal closes, success toast fires, and the active marriage disappears.
    await waitFor(() => expect(view!.queryByTestId('dissolve-confirm-modal')).not.toBeInTheDocument());
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    await waitFor(() => expect(view!.getByText(/no active marriages/i)).toBeInTheDocument());

    // The dissolved marriage now surfaces in "Past marriages" (real backend
    // data via courtship.marriages{activeOnly:false}, not fabricated).
    await waitFor(() => expect(view!.getByTestId('past-marriage-list')).toBeInTheDocument());
    expect(view!.getByText(/npc:npc_kel_999/)).toBeInTheDocument();
  });

  it('a rejected dissolve (not a party) surfaces an error and keeps the marriage active', async () => {
    const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url.includes('/api/lens/run')) {
        if (body?.name === 'constants') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CONSTANTS_OK) } as Response);
        }
        if (body?.name === 'dissolve') {
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ ok: true, result: { ok: false, reason: 'not_a_party' } }),
          } as Response);
        }
        if (body?.name === 'marriages') {
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ ok: true, result: { ok: true, marriages: [ACTIVE_MARRIAGE] } }),
          } as Response);
        }
      }
      if (url.includes('/api/courtship/mine')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, courtships: [] }) } as Response);
      }
      if (url.includes('/api/courtship/marriages/mine')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ ok: true, marriages: [ACTIVE_MARRIAGE], children: [] }),
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } as Response);
    });
    global.fetch = fn as unknown as typeof fetch;

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CourtshipLensPage />); });
    await waitFor(() => expect(view!.getByTestId('marriage-list')).toBeInTheDocument());

    await act(async () => { fireEvent.click(view!.getByLabelText('End marriage to npc_kel_999')); });
    await act(async () => { fireEvent.click(view!.getByLabelText('Confirm end marriage to npc:npc_kel_999')); });

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
    // Still shown as active — the rejection didn't fabricate a success.
    expect(view!.getByLabelText('End marriage to npc_kel_999')).toBeInTheDocument();
  });
});
