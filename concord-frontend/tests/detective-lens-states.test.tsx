/**
 * /lenses/detective — four-UX-state contract.
 *
 * Pins that the deduction board renders genuine loading / error (with a
 * retry affordance) / empty / populated states against the real REST
 * surface (/api/detective/open/:worldId + /crime/:id/evidence + /deduce),
 * plus a11y (the world input + lock-in inputs carry accessible names).
 *
 * No fabricated data: every state is driven by a mocked fetch standing in
 * for the real backend, exactly the shape server/lib/detective.js returns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import DetectiveLensPage from '@/app/lenses/detective/page';

function jsonOk(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function httpFail(status: number) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve({ ok: false }) });
}

const OPEN_CASES = {
  ok: true,
  crimes: [
    { id: 'crime_1', crime_type: 'theft', location_id: 'bld_market', victim_id: 'npc_v', occurred_at: 1 },
  ],
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('detective lens — four UX states', () => {
  it('LOADING: shows a skeleton while open cases are in flight', async () => {
    // Never-resolving fetch keeps the board in the loading state.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { getByTestId } = render(<DetectiveLensPage />);
    expect(getByTestId('cases-loading')).toBeInTheDocument();
    expect(getByTestId('cases-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows an honest error + a working Retry that re-fetches', async () => {
    const fetchMock = vi.fn(() => httpFail(500));
    vi.stubGlobal('fetch', fetchMock);
    const { getByTestId, getByText } = render(<DetectiveLensPage />);

    await waitFor(() => expect(getByTestId('cases-error')).toBeInTheDocument());
    expect(getByTestId('cases-error')).toHaveAttribute('role', 'alert');

    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('EMPTY: shows an honest empty state when the world has no open cases', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk({ ok: true, crimes: [] })));
    const { getByTestId } = render(<DetectiveLensPage />);
    await waitFor(() => expect(getByTestId('cases-empty')).toBeInTheDocument());
    expect(getByTestId('cases-empty').textContent).toMatch(/no open cases/i);
  });

  it('POPULATED: renders the open-case list and the world input is labelled (a11y)', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/detective/open/')) return jsonOk(OPEN_CASES);
      if (String(url).includes('/evidence')) return jsonOk({ ok: true, evidence: [] });
      return jsonOk({ ok: true });
    }));
    const { getByTestId, getByLabelText } = render(<DetectiveLensPage />);
    await waitFor(() => expect(getByTestId('cases-list')).toBeInTheDocument());
    expect(getByTestId('cases-list').textContent).toMatch(/theft/i);
    // a11y: world selector has an accessible name.
    expect(getByLabelText('World')).toBeInTheDocument();
  });

  it('drives the real deduce route and surfaces the 2-of-3 + suspect_match verdict', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/detective/open/')) return jsonOk(OPEN_CASES);
      if (u.includes('/evidence')) return jsonOk({ ok: true, evidence: [] });
      if (u.includes('/deduce')) {
        const body = JSON.parse(String(init?.body));
        // Mirror lockInDeduction: solved only with >=2 correct AND suspect_match.
        const solved = body.suspectId === 'npc_mallory' && !!body.weapon;
        return jsonOk({ ok: true, solved, correctCount: solved ? 2 : 1, reasons: solved ? ['suspect_match', 'weapon_match'] : ['suspect_match'] });
      }
      return jsonOk({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByTestId, getByText, getByPlaceholderText } = render(<DetectiveLensPage />);
    await waitFor(() => expect(getByTestId('cases-list')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText('theft')); });
    await act(async () => {
      fireEvent.change(getByPlaceholderText('Suspect ID'), { target: { value: 'npc_mallory' } });
      fireEvent.change(getByPlaceholderText(/Weapon/i), { target: { value: 'theft' } });
    });
    await act(async () => { fireEvent.click(getByText(/Submit deduction/i)); });

    await waitFor(() => expect(getByTestId('deduce-result')).toBeInTheDocument());
    expect(getByTestId('deduce-result').textContent).toMatch(/Case solved/i);
    expect(getByTestId('deduce-result').textContent).toMatch(/2\/3/);

    const deduceCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/deduce'));
    expect(deduceCall).toBeTruthy();
    expect((deduceCall![1] as RequestInit).method).toBe('POST');
  });
});
