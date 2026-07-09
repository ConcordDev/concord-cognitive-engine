/**
 * /lenses/philosophy — four-UX-state contract for the Philosophy lens
 * (Frontend Rebuild Program, Wave 2 rebuild).
 *
 * The rebuild retired a generic multi-artifact-type CRUD library
 * (Argument/Concept/Thinker/Tradition/Dialogue, backed by fabricated DTU
 * artifacts at `/api/lens/philosophy` unrelated to the real `philosophy`
 * macros) that used to be this lens's PRIMARY surface, including a "Run AI
 * analysis" button that dispatched an unregistered `philosophy.analyze`
 * action (silently falling through to a generic utility-brain AI
 * catch-all with no UI surface for the result). This test file pins the
 * four UX states of the REAL surface that replaced it —
 * `PhilosophyOverview`, the default "Overview" destination, which
 * aggregates four live macro calls (philosophy-dashboard / debate-list /
 * reference-list / public-channels) via `lensRun('philosophy', ...)`.
 *
 * a11y: loading is role=status, error is role=alert (with the real error
 * message surfaced, not swallowed), empty is a real `EmptyState` CTA that
 * jumps to Curation Studio, populated renders real KPI tile values sourced
 * from the mocked macro results. No fabricated data — every state is
 * driven by a mocked `lensRun` standing in for the real backend in the
 * exact shape it returns. The heavier Dilemma Workbench / Curation Studio
 * / Community Pulse children (DilemmaPanel / PhilosophyChannels /
 * PhilosophyCuration / PhiloFeed) carry their own macro coverage in
 * server/tests/philosophy-domain-parity.test.js and are inert here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

// ── the single real data channel this page depends on: lensRun ─────────────
type LensRunImpl = (domain: string, action: string, input?: unknown) => Promise<{ data: { ok: boolean; result?: unknown; error?: string } }>;
const lensRunMock = vi.fn<Parameters<LensRunImpl>, ReturnType<LensRunImpl>>();

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: (...args: Parameters<LensRunImpl>) => lensRunMock(...args),
  isForbidden: () => false,
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// ── headless chrome + heavy destination panels: render-only / inert stubs ──
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
// heavy philosophy children (their own backend macros are covered by the
// philosophy domain-parity server test) → inert here; the Overview
// destination (default on mount) is the one under test.
vi.mock('@/components/philosophy/DilemmaPanel', () => ({ DilemmaPanel: () => null }));
vi.mock('@/components/philosophy/PhilosophyChannels', () => ({ PhilosophyChannels: () => null }));
vi.mock('@/components/philosophy/PhilosophyCuration', () => ({ PhilosophyCuration: () => null }));
vi.mock('@/components/philosophy/PhiloFeed', () => ({ PhiloFeed: () => null }));
vi.mock('@/components/wiki/WikipediaSearchPanel', () => ({ WikipediaSearchPanel: () => null }));
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

import PhilosophyLensPage from '@/app/lenses/philosophy/page';

function neverResolves() {
  return new Promise<never>(() => {});
}

const EMPTY_RESULTS: Record<string, unknown> = {
  'philosophy-dashboard': { channels: 0, blocks: 0, connectedBlocks: 0, byKind: { text: 0, link: 0, quote: 0, image: 0, embed: 0 } },
  'debate-list': { threads: [], count: 0 },
  'reference-list': { references: [], count: 0 },
  'public-channels': { channels: [], count: 0 },
};

const POPULATED_RESULTS: Record<string, unknown> = {
  'philosophy-dashboard': { channels: 3, blocks: 12, connectedBlocks: 2, byKind: { text: 6, link: 3, quote: 3, image: 0, embed: 0 } },
  'debate-list': {
    threads: [
      { id: 'dbt_1', title: 'Is free will real?', claim: 'Free will exists.', branch: 'metaphysics', status: 'open', postCount: 5 },
      { id: 'dbt_2', title: 'Trolley variants', claim: 'Numbers matter morally.', branch: 'ethics', status: 'resolved', postCount: 9 },
    ],
    count: 2,
  },
  'reference-list': { references: [{ id: 'ref_1' }, { id: 'ref_2' }], count: 2 },
  'public-channels': { channels: [{ id: 'ch_1' }], count: 1 },
};

function mockResolveWith(results: Record<string, unknown>) {
  lensRunMock.mockImplementation((_domain, action) =>
    Promise.resolve({ data: { ok: true, result: results[action] } }));
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('philosophy lens — four UX states (Overview)', () => {
  it('WIRING: the overview dispatches real macros on the philosophy domain', async () => {
    mockResolveWith(EMPTY_RESULTS);
    render(<PhilosophyLensPage />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const domains = lensRunMock.mock.calls.map((c) => c[0]);
    expect(domains.every((d) => d === 'philosophy')).toBe(true);
    const actions = lensRunMock.mock.calls.map((c) => c[1]);
    expect(actions).toEqual(expect.arrayContaining(['philosophy-dashboard', 'debate-list', 'reference-list', 'public-channels']));
    // the retired fake-CRUD action must never be dispatched.
    expect(actions).not.toContain('analyze');
  });

  it('LOADING: an in-flight overview shows a role=status indicator', async () => {
    lensRunMock.mockImplementation(() => neverResolves());
    const { container } = render(<PhilosophyLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: an empty workspace shows the honest empty-state CTA (not fabricated data)', async () => {
    mockResolveWith(EMPTY_RESULTS);
    const { getByText, getAllByText } = render(<PhilosophyLensPage />);
    await waitFor(() => expect(getByText(/philosophy workspace is empty/i)).toBeInTheDocument());
    expect(getAllByText(/Open Curation Studio/i).length).toBeGreaterThan(0);
  });

  it('ERROR: a failed macro call shows role=alert with the real error (not a silent empty page)', async () => {
    lensRunMock.mockImplementation(() => Promise.reject(new Error('philosophy store offline')));
    const { container, getByText, queryByText } = render(<PhilosophyLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/philosophy store offline/i)).toBeInTheDocument();
    expect(queryByText(/philosophy workspace is empty/i)).toBeNull();
  });

  it('POPULATED: real channel/debate/reference counts render as KPI tiles', async () => {
    mockResolveWith(POPULATED_RESULTS);
    const { getByText, getAllByText } = render(<PhilosophyLensPage />);
    // Idea channels tile: real value 3 from the mocked philosophy-dashboard.
    await waitFor(() => expect(getAllByText('3').length).toBeGreaterThan(0));
    // Debate threads tile: real value 2.
    expect(getAllByText('2').length).toBeGreaterThan(0);
    // Recent debate thread renders its real title.
    expect(getByText(/Is free will real\?/i)).toBeInTheDocument();
  });
});
