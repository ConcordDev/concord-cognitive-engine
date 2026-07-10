/**
 * /lenses/detective — four-UX-state contract for the rebuilt Detective board.
 *
 * The rebuild (Frontend Rebuild Program, Phase 3) moved the board off raw
 * REST `fetch` onto the real macro channel — `lensRun('detective', 'list'|
 * 'get'|'deduce'|'mine', input)` → POST /api/lens/run (answered by
 * server/domains/detective.js, a thin delegator over server/lib/detective.js
 * — the same backend the old REST routes called, just reached the way the
 * rest of the rebuilt lenses reach their macros — see e.g.
 * tests/council-lens-states.test.tsx for the same convention). This pins
 * genuine loading / error (with a working retry) / empty / populated states,
 * the evidence → suspect quick-fill micro-interaction, the deduce flow, and
 * a11y — no fabricated data, every state driven by a mocked `lensRun`
 * returning exactly the shapes the detective macros return.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { KeyboardProvider } from '@/lib/keyboard';

// ── the real macro channel, mocked per-test ─────────────────────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER the mock is registered.
import DetectiveLensPage from '@/app/lenses/detective/page';

// The board registers real keyboard commands (r / 1 / 2 / mod+enter) via
// useLensCommand, which requires a KeyboardProvider ancestor — same
// requirement any consumer of the shell's command palette has outside the
// full AppShell tree.
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
function err(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

const OPEN_CASE = {
  id: 'crime_1', crime_type: 'theft', location_type: 'building', location_id: 'bld_market',
  victim_id: 'npc_v', confidence: 0.4, occurred_at: 1,
};

const EVIDENCE_WITH_SUSPECT = [
  { id: 'ev_1', evidence_type: 'footprint', description: 'Muddy prints near the stall.', links_to_id: 'npc_mallory', links_to_type: 'npc', confidence_boost: 0.2, collected_at: 1, decay_at: null },
];

beforeEach(() => {
  lensRunMock.mockReset();
});

/** Wires list/get/mine/deduce with sensible defaults, overridable per test. */
function wireLensRun(overrides: Partial<Record<'list' | 'get' | 'mine' | 'deduce', () => Promise<unknown>>> = {}) {
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain !== 'detective') return ok({});
    if (action === 'list') return (overrides.list ?? (() => ok({ crimes: [OPEN_CASE] })))();
    if (action === 'get') return (overrides.get ?? (() => ok({ crime: { ...OPEN_CASE, status: 'open', resolved_at: null }, evidence: EVIDENCE_WITH_SUSPECT })))();
    if (action === 'mine') return (overrides.mine ?? (() => ok({ deductions: [] })))();
    if (action === 'deduce') return (overrides.deduce ?? (() => ok({ deductionId: 'ded_1', correctCount: 1, reasons: [], solved: false, discovery: null })))();
    return ok({});
  });
}

describe('detective lens — four UX states', () => {
  it('LOADING: shows a skeleton while open cases are in flight', async () => {
    lensRunMock.mockImplementation(() => new Promise(() => {}));
    const { getByTestId } = renderPage();
    expect(getByTestId('cases-loading')).toBeInTheDocument();
    expect(getByTestId('cases-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows an honest error + a working Retry that re-dispatches', async () => {
    wireLensRun({ list: () => err('HTTP 500') });
    const { getByRole, getByText } = renderPage();

    await waitFor(() => expect(getByRole('alert')).toBeInTheDocument());

    const callsBefore = lensRunMock.mock.calls.length;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    expect(lensRunMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('EMPTY: shows an honest empty state when the world has no open cases', async () => {
    wireLensRun({ list: () => ok({ crimes: [] }) });
    const { getByText } = renderPage();
    await waitFor(() => expect(getByText(/no open cases/i)).toBeInTheDocument());
  });

  it('POPULATED: renders the open-case list and the world input is labelled (a11y)', async () => {
    wireLensRun();
    const { getByTestId, getByLabelText } = renderPage();
    await waitFor(() => expect(getByTestId('cases-list')).toBeInTheDocument());
    expect(getByTestId('cases-list').textContent).toMatch(/theft/i);
    // a11y: world selector has an accessible name.
    expect(getByLabelText('World')).toBeInTheDocument();
  });

  it('selecting a case loads its evidence, and naming a suspect from evidence fills the form', async () => {
    wireLensRun();
    const { getByTestId, getByText, getByPlaceholderText } = renderPage();
    await waitFor(() => expect(getByTestId('cases-list')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText(/Theft/)); });
    await waitFor(() => expect(getByTestId('evidence-list')).toBeInTheDocument());

    // Micro-interaction: clicking the evidence's "Name <suspect>" chip fills
    // the deduction form's suspect field with the real linked id.
    await act(async () => { fireEvent.click(getByText(/Name npc_mallory/i)); });
    const suspectInput = getByPlaceholderText(/Suspect ID/i) as HTMLInputElement;
    expect(suspectInput.value).toBe('npc_mallory');
  });

  it('drives the real deduce macro and surfaces the 2-of-3 + suspect_match verdict', async () => {
    wireLensRun({
      deduce: () => ok({ deductionId: 'ded_2', correctCount: 2, reasons: ['suspect_match', 'weapon_match'], solved: true, discovery: { nodeId: 'disc_crime_1' } }),
    });

    const { getByTestId, getByText, getByPlaceholderText } = renderPage();
    await waitFor(() => expect(getByTestId('cases-list')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText(/Theft/)); });
    await waitFor(() => expect(getByTestId('evidence-list')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(getByPlaceholderText(/Suspect ID/i), { target: { value: 'npc_mallory' } });
      fireEvent.change(getByPlaceholderText(/Weapon/i), { target: { value: 'theft' } });
    });
    await act(async () => { fireEvent.click(getByText(/Submit deduction/i)); });

    await waitFor(() => expect(getByTestId('deduce-result')).toBeInTheDocument());
    expect(getByTestId('deduce-result').textContent).toMatch(/Case solved/i);
    expect(getByTestId('deduce-result').textContent).toMatch(/2\/3/);
    // Real discovery reward surfaces honestly (no discovery → no such copy).
    expect(getByTestId('deduce-result').textContent).toMatch(/evidence-locker essence/i);

    const deduceCall = lensRunMock.mock.calls.find((c) => c[0] === 'detective' && c[1] === 'deduce');
    expect(deduceCall).toBeTruthy();
    expect((deduceCall as unknown[])[2]).toMatchObject({ crimeId: 'crime_1', suspectId: 'npc_mallory', weapon: 'theft' });
  });

  it('MY CASE FILE: an unauthenticated/no-history caller sees an honest empty state, not a fabricated table', async () => {
    wireLensRun({ mine: () => ok({ deductions: [] }) });
    const { getByText } = renderPage();
    await act(async () => { fireEvent.click(getByText(/My case file/)); });
    await waitFor(() => expect(getByText(/no deductions filed yet/i)).toBeInTheDocument());
  });

  it('MY CASE FILE: renders real past verdicts and selecting one loads that case dossier', async () => {
    wireLensRun({
      mine: () => ok({ deductions: [{ id: 'ded_9', crime_id: 'crime_9', suspect_id: 'npc_x', verdict: 'guilty', sentence_data: JSON.stringify({ correctCount: 3 }), processed_at: 5 }] }),
      get: () => ok({ crime: { id: 'crime_9', crime_type: 'murder', location_id: 'bld_alley', victim_id: 'npc_v2', status: 'solved', confidence: 0.9, occurred_at: 1, resolved_at: 5 }, evidence: [] }),
    });
    const { getByText, getByTestId } = renderPage();
    await act(async () => { fireEvent.click(getByText(/My case file/)); });
    await waitFor(() => expect(getByText('crime_9')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText('crime_9')); });
    await waitFor(() => expect(getByTestId('deduction-disabled')).toBeInTheDocument());
    expect(getByTestId('deduction-disabled').textContent).toMatch(/already solved/i);
  });
});
