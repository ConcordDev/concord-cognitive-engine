/**
 * /lenses/ghost-tracker — four-UX-state + a11y contract.
 *
 * Pins that the Ghost Tracker lens renders genuine loading / empty / populated
 * states against the REAL backend surface (lensRun('ghost-hunt', 'residues')
 * → POST /api/lens/run) plus a real artifact-backed Saved Dossiers rail
 * (useLensData('ghost-tracker','spectral_dossier') → /api/lens/ghost-tracker),
 * with that rail's own loading / error / empty / populated branches.
 *
 * No fabricated data: every state is driven by mocks standing in for the real
 * backend, exactly the shape server/domains/ghost-hunt.js returns. The headless
 * LensShell + heavy child components (which fire their own backend calls) are
 * stubbed so the test stays on the page's own state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the residue-list backend channel ─────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── useLensData mock — the Saved Dossiers artifact channel ──────────────────
const lensData = vi.fn();
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (...args: unknown[]) => lensData(...args),
}));

// ── headless shell + lens chrome: render-only stubs ─────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// ── heavy ghost-tracker children fire their own backend calls — stub them ───
vi.mock('@/components/ghost-tracker/HauntingsFeed', () => ({ HauntingsFeed: () => null }));
vi.mock('@/components/ghost-tracker/ResidueDetail', () => ({ ResidueDetail: () => null }));
vi.mock('@/components/ghost-tracker/ResidueMap', () => ({ ResidueMap: () => null }));
vi.mock('@/components/ghost-tracker/HunterLeaderboard', () => ({ HunterLeaderboard: () => null }));
vi.mock('@/components/ghost-tracker/ConfrontHistory', () => ({ ConfrontHistory: () => null }));
vi.mock('@/components/ghost-tracker/ActiveHunts', () => ({ ActiveHunts: () => null }));

// Import AFTER mocks are registered.
import GhostTrackerPage from '@/app/lenses/ghost-tracker/page';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const RESIDUES = [
  {
    id: 'res_1', drift_type: 'spectral', severity: 'low', signature: 'sig-alpha',
    context_json: '{}', detected_at: 1_700_000_000, stage: 'track', confronted: false,
    coords: { x: 12, z: -40 },
  },
  {
    id: 'res_2', drift_type: 'echo_chamber', severity: 'high', signature: 'sig-beta',
    context_json: '{}', detected_at: 1_700_000_500, stage: 'extinguished', confronted: true,
    coords: { x: -8, z: 96 },
  },
];

// Default: Saved Dossiers rail resolves empty (overridden per-test).
function dossierState(over: Record<string, unknown> = {}) {
  return { items: [], isLoading: false, isError: false, ...over };
}

beforeEach(() => {
  lensRun.mockReset();
  lensData.mockReset();
  lensData.mockReturnValue(dossierState());
});

describe('ghost-tracker lens — four UX states', () => {
  it('LOADING: shows the residue loading indicator while residues are in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByText } = render(<GhostTrackerPage />);
    await waitFor(() => expect(getByText(/Loading residues/i)).toBeInTheDocument());
  });

  it('EMPTY: shows the honest "world reads true" empty state when residues === 0', async () => {
    lensRun.mockImplementation(() => reply({ ok: true, residues: [], driftTypes: [], severities: [] }));
    const { getByText } = render(<GhostTrackerPage />);
    await waitFor(() => expect(getByText(/world reads true/i)).toBeInTheDocument());
  });

  it('POPULATED: renders real residues from ghost-hunt.residues + the active/extinguished tally', async () => {
    lensRun.mockImplementation(() => reply({
      ok: true, residues: RESIDUES,
      driftTypes: ['spectral', 'echo_chamber'], severities: ['low', 'high'],
    }));
    const { getByText, getAllByText } = render(<GhostTrackerPage />);
    await waitFor(() => expect(getAllByText('spectral').length).toBeGreaterThan(0));
    // tally reflects 1 active + 1 extinguished from the real data
    expect(getByText(/1 active · 1 extinguished/)).toBeInTheDocument();
    // coords from the residue render
    expect(getByText(/cell x12 z-40/)).toBeInTheDocument();
    // the residue list calls the REAL ghost-hunt domain, not a phantom one
    expect(lensRun.mock.calls.every((c) => c[0] === 'ghost-hunt')).toBe(true);
    expect(lensRun.mock.calls.some((c) => c[1] === 'residues')).toBe(true);
  });
});

describe('ghost-tracker lens — Saved Dossiers rail (real artifact persistence)', () => {
  beforeEach(() => {
    lensRun.mockImplementation(() => reply({ ok: true, residues: [], driftTypes: [], severities: [] }));
  });

  it('binds the dossier rail to the real ghost-tracker / spectral_dossier artifact type', async () => {
    render(<GhostTrackerPage />);
    await waitFor(() => expect(lensData).toHaveBeenCalled());
    const [domain, type] = lensData.mock.calls[0];
    expect(domain).toBe('ghost-tracker');
    expect(type).toBe('spectral_dossier');
  });

  it('LOADING: shows a role=status while dossiers load', async () => {
    lensData.mockReturnValue(dossierState({ isLoading: true }));
    const { container, getByText } = render(<GhostTrackerPage />);
    await waitFor(() => expect(getByText(/Loading dossiers/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('ERROR: shows role=alert when the dossier index is unreachable', async () => {
    lensData.mockReturnValue(dossierState({ isError: true }));
    const { container, getByText } = render(<GhostTrackerPage />);
    await waitFor(() => expect(getByText(/Dossier index unreachable/i)).toBeInTheDocument());
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('EMPTY: shows the honest "no dossiers yet" hint', async () => {
    lensData.mockReturnValue(dossierState({ items: [] }));
    const { getByText } = render(<GhostTrackerPage />);
    await waitFor(() => expect(getByText(/No dossiers yet/i)).toBeInTheDocument());
  });

  it('POPULATED: renders saved dossiers from the artifact store', async () => {
    lensData.mockReturnValue(dossierState({
      items: [
        { id: 'd1', title: 'Case file: the delta drift', data: { drift_type: 'memetic_drift', severity: 'medium' } },
      ],
    }));
    const { getByText } = render(<GhostTrackerPage />);
    await waitFor(() => expect(getByText('Case file: the delta drift')).toBeInTheDocument());
  });
});

describe('ghost-tracker lens — a11y', () => {
  beforeEach(() => {
    lensRun.mockImplementation(() => reply({
      ok: true, residues: RESIDUES, driftTypes: ['spectral'], severities: ['low', 'high'],
    }));
  });

  it('the Saved Dossiers section carries an accessible region label', async () => {
    const { getByLabelText } = render(<GhostTrackerPage />);
    await waitFor(() => expect(getByLabelText('Saved Spectral Dossiers')).toBeInTheDocument());
  });
});
