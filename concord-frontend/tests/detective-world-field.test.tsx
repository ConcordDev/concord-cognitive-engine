/**
 * /lenses/detective — F2 pins (determination record, 2026-11-01; Lead
 * compilation §5d, 2026-11-03): the World field validates against the
 * worlds on record (KNOWN_WORLD_IDS).
 *
 * Before this fix the field accepted any string and fired detective.list
 * with it — an unknown string rendered its own "No unsolved crimes are on
 * record for …" empty state, and clearing the field sent worldId "" → the
 * macro's `missing_world` reason surfaced as the pane's raw-code error,
 * debug chrome and all. The priced cure (this suite's contract):
 *   - a cleared field answers with a member-readable prompt, no error
 *     state, no raw code, and list is never called with "";
 *   - an unknown string answers with a member-readable notice and list is
 *     never called with it;
 *   - a known world fires list with it, exactly as before;
 *   - the default concordia-hub load is unchanged (control).
 *
 * Same harness as tests/detective-lens-states.test.tsx: the real macro
 * channel mocked per test via `lensRun`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { KeyboardProvider } from '@/lib/keyboard';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import DetectiveLensPage from '@/app/lenses/detective/page';

function renderPage() {
  return render(
    <KeyboardProvider>
      <DetectiveLensPage />
    </KeyboardProvider>,
  );
}

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

const OPEN_CASE = {
  id: 'crime_1', crime_type: 'theft', location_type: 'building', location_id: 'bld_market',
  victim_id: 'npc_v', confidence: 0.4, occurred_at: 1,
};

function listWorldIds(): unknown[] {
  return lensRunMock.mock.calls
    .filter((c) => c[0] === 'detective' && c[1] === 'list')
    .map((c) => (c[2] as { worldId?: unknown }).worldId);
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((domain: string, action: string, input?: { worldId?: string }) => {
    if (domain !== 'detective') return ok({});
    if (action === 'list') {
      // concordia-hub has a case; every other world reads empty. A call
      // with "" or an unknown world would still answer ok here — the pins
      // below assert such a call is never made.
      return ok({ crimes: input?.worldId === 'concordia-hub' ? [OPEN_CASE] : [] });
    }
    if (action === 'mine') return ok({ deductions: [] });
    return ok({});
  });
});

describe('detective World field — F2 validation', () => {
  it('CONTROL: the default world loads its open cases, as before', async () => {
    const { getByTestId } = renderPage();
    await waitFor(() => expect(getByTestId('cases-list')).toBeInTheDocument());
    expect(listWorldIds()).toEqual(['concordia-hub']);
  });

  it('CLEARED: a cleared field answers with a readable prompt — no list call with "", no raw code, no error state', async () => {
    const { getByLabelText, getByText, queryByRole, container } = renderPage();
    await waitFor(() => expect(listWorldIds()).toEqual(['concordia-hub']));

    await act(async () => {
      fireEvent.change(getByLabelText('World'), { target: { value: '' } });
    });

    await waitFor(() => expect(getByText(/choose a world/i)).toBeInTheDocument());
    expect(listWorldIds()).not.toContain('');
    expect(container.textContent).not.toMatch(/missing_world/);
    expect(queryByRole('alert')).not.toBeInTheDocument();

    // Recovery: naming a world on record again reloads its board.
    await act(async () => {
      fireEvent.change(getByLabelText('World'), { target: { value: 'concordia-hub' } });
    });
    await waitFor(() => expect(container.textContent).toMatch(/theft/i));
  });

  it('UNKNOWN: an unknown string answers with a readable notice and never reaches the server', async () => {
    const { getByLabelText, getByText, container } = renderPage();
    await waitFor(() => expect(listWorldIds()).toEqual(['concordia-hub']));

    await act(async () => {
      fireEvent.change(getByLabelText('World'), { target: { value: 'concordia-hubx' } });
    });

    await waitFor(() => expect(getByText(/not a world on record/i)).toBeInTheDocument());
    expect(container.textContent).toMatch(/concordia-hubx/);
    expect(listWorldIds()).not.toContain('concordia-hubx');
    expect(container.textContent).not.toMatch(/missing_world/);
    // The old behaviour — an empty-case state for a world that doesn't
    // exist — is gone.
    expect(container.textContent).not.toMatch(/no unsolved crimes are on record for/i);
  });

  it('KNOWN: switching to another world on record fires list with it and reads its board', async () => {
    const { getByLabelText, getByText } = renderPage();
    await waitFor(() => expect(listWorldIds()).toEqual(['concordia-hub']));

    await act(async () => {
      fireEvent.change(getByLabelText('World'), { target: { value: 'tunya' } });
    });

    await waitFor(() => expect(listWorldIds()).toContain('tunya'));
    await waitFor(() => expect(getByText(/no open cases/i)).toBeInTheDocument());
    expect(getByText(/no unsolved crimes are on record for "tunya"/i)).toBeInTheDocument();
  });
});
