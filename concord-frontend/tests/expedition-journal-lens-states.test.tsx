/**
 * /lenses/expedition-journal — four-UX-state contract + a11y.
 *
 * Pins that the Expedition Journal lens renders genuine
 * loading / error (with a working Retry) / empty / populated states against the
 * real macro surface (lensRun('expedition-journal', …) → POST /api/lens/run),
 * plus a11y (loading is role=status, error is role=alert, the view + world
 * selectors are role=tab with aria-selected).
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, exactly the shape server/domains/expedition-journal.js
 * returns. The headless shell + the auxiliary cross-lens panels are stubbed so
 * the test stays on the page's own state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the page's single backend channel ────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── headless shell + auxiliary panels: render-only stubs ────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/expedition-journal/BaseCampAlmanac', () => ({ BaseCampAlmanac: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

// Import AFTER mocks are registered.
import ExpeditionJournalPage from '@/app/lenses/expedition-journal/page';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const WORLDS = [
  { worldId: 'cyber', stageCount: 2, stages: [
    { id: 'arrive', title: 'Jack in', objective: 'Enter the net.', xp: 25 },
    { id: 'record', title: 'Log', objective: 'Write your run report.', xp: 35 },
  ] },
  { worldId: 'fantasy', stageCount: 1, stages: [
    { id: 'arrive', title: 'Enter the realm', objective: 'Step through the gate.', xp: 25 },
  ] },
];

const PROGRESS = {
  worldId: 'cyber',
  stages: [
    { id: 'arrive', title: 'Jack in', objective: 'Enter the net.', xp: 25, done: true, completedAt: '2026-06-27T00:00:00Z' },
    { id: 'record', title: 'Log', objective: 'Write your run report.', xp: 35, done: false, completedAt: null },
  ],
  completed: 1, total: 2, percent: 50, expeditionComplete: false,
};

const SUMMARY = {
  worlds: [{ worldId: 'cyber', stages: [], completed: 1, total: 2, percent: 50, expeditionComplete: false }],
  totalStages: 3, completedStages: 1, overallPercent: 33,
  completedWorlds: 0, totalWorlds: 2, xp: 25, level: 1, badgeCount: 0,
  entryCount: 0, photoCount: 0,
};

beforeEach(() => { lensRun.mockReset(); });

describe('expedition-journal lens — four UX states + a11y', () => {
  it('LOADING: shows a role=status indicator while the world catalog is in flight', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'worlds') return new Promise(() => {}); // never resolves
      return reply({});
    });
    const { getByText, container } = render(<ExpeditionJournalPage />);
    await waitFor(() => expect(getByText(/Loading expeditions/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('ERROR: a failed worlds load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'worlds') {
        if (fail) return Promise.reject(new Error('network down'));
        return reply({ worlds: WORLDS });
      }
      if (name === 'progress') return reply(PROGRESS);
      if (name === 'summary') return reply(SUMMARY);
      if (name === 'rewards') return reply({ badges: [] });
      return reply({});
    });
    const { getByText, getByRole, container } = render(<ExpeditionJournalPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/expedition service/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'worlds').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'worlds').length).toBeGreaterThan(before));
    // recovers to populated — the Cyber world tab is now reachable
    await waitFor(() => expect(getByRole('tab', { name: /Cyber/i })).toBeInTheDocument());
  });

  it('ERROR (ok:false): a backend error surfaces the returned message', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'worlds' ? Promise.resolve({ data: { ok: false, error: 'expeditions offline' } }) : reply({}));
    const { getByText, container } = render(<ExpeditionJournalPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/expeditions offline/i)).toBeInTheDocument();
  });

  it('EMPTY: shows the honest no-expeditions CTA when the catalog is empty', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'worlds' ? reply({ worlds: [] }) : reply({}));
    const { getByText } = render(<ExpeditionJournalPage />);
    await waitFor(() => expect(getByText(/No expeditions to chart yet/i)).toBeInTheDocument());
  });

  it('POPULATED: renders world tabs + per-stage progress from real macro data', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'worlds') return reply({ worlds: WORLDS });
      if (name === 'progress') return reply(PROGRESS);
      if (name === 'summary') return reply(SUMMARY);
      if (name === 'rewards') return reply({ badges: [] });
      return reply({});
    });
    const { getByText, getByRole, getAllByText } = render(<ExpeditionJournalPage />);
    await waitFor(() => expect(getByRole('tab', { name: /Cyber/i })).toBeInTheDocument());
    // world tabs
    expect(getByRole('tab', { name: /Fantasy/i })).toBeInTheDocument();
    // per-world header from progress macro
    await waitFor(() => expect(getByText(/1\/2 stages complete/)).toBeInTheDocument());
    // stage cards rendered
    expect(getByText('Jack in')).toBeInTheDocument();
    expect(getAllByText(/\+25 XP/).length).toBeGreaterThan(0);
    // the worlds macro was actually called
    expect(lensRun.mock.calls.some((c) => c[1] === 'worlds')).toBe(true);
    expect(lensRun.mock.calls.some((c) => c[1] === 'progress')).toBe(true);
  });

  it('a11y: view + world selectors are role=tab with aria-selected', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'worlds') return reply({ worlds: WORLDS });
      if (name === 'progress') return reply(PROGRESS);
      if (name === 'summary') return reply(SUMMARY);
      if (name === 'rewards') return reply({ badges: [] });
      return reply({});
    });
    const { container, getByRole } = render(<ExpeditionJournalPage />);
    await waitFor(() => expect(getByRole('tablist', { name: /Expedition journal views/i })).toBeInTheDocument());
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBeGreaterThanOrEqual(4); // 2 view tabs + ≥2 world tabs
    // exactly one selected view tab
    const selectedViews = Array.from(container.querySelectorAll('[role="tablist"][aria-label="Expedition journal views"] [role="tab"][aria-selected="true"]'));
    expect(selectedViews.length).toBe(1);
  });

  it('SUMMARY tab toggles to the cross-world rollup', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'worlds') return reply({ worlds: WORLDS });
      if (name === 'progress') return reply(PROGRESS);
      if (name === 'summary') return reply(SUMMARY);
      if (name === 'rewards') return reply({ badges: [] });
      return reply({});
    });
    const { getByRole } = render(<ExpeditionJournalPage />);
    await waitFor(() => expect(getByRole('tab', { name: /Cyber/i })).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByRole('tab', { name: /Cross-world summary/i })); });
    // ExpeditionSummary mounts with real summary data — it requests the summary macro
    expect(lensRun.mock.calls.some((c) => c[1] === 'summary')).toBe(true);
  });
});
