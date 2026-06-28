/**
 * /lenses/self — four-UX-state contract (Overview surface).
 *
 * The Self lens is a quantified-self ledger. Its default "Overview" tab is
 * driven by OverviewDashboard, which pulls the REAL STATE-backed self.overview
 * + self.layout macros through the lensRun channel. This test pins that the
 * Overview surface renders genuine:
 *   - LOADING   (role="status" while the overview is in flight),
 *   - ERROR     (role="alert" + a WORKING Retry that re-fetches) — a backend
 *               { ok:false } is surfaced as a real error, NOT swallowed into a
 *               silent blank "No data yet" page (the defect class fixed across
 *               sibling lenses),
 *   - EMPTY     (an honest "No data yet" CTA when the ledger has no readings),
 *   - POPULATED (the real metric tiles with accurate aggregated values).
 *
 * No fabricated data: every state is driven by a controllable mock of the
 * component's single macro channel (lensRun), in exactly the envelope the
 * server returns ({ data: { ok, result } }).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── the component's macro channel (lensRun) + the page's apiHelpers channel ──
const lensRun = vi.fn();
const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));

// ── lucide icons → inert spans ───────────────────────────────────────────────
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
import { OverviewDashboard } from '@/components/self/OverviewDashboard';

// macro envelope helper — exactly the { data: { ok, result } } the server returns.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

// The default layout payload (self.layout) — always resolves harmlessly so the
// tests drive state via self.overview.
function layoutReply() {
  return reply({
    tiles: ['steps', 'sleep_hours', 'workout_min', 'mood'],
    isDefault: true,
    available: [
      { key: 'steps', label: 'Steps', unit: 'steps' },
      { key: 'sleep_hours', label: 'Sleep', unit: 'h' },
    ],
  });
}

beforeEach(() => {
  lensRun.mockReset();
});

const noop = () => {};

describe('self lens — four UX states (Overview surface)', () => {
  it('LOADING: shows a role=status indicator while the overview is in flight', async () => {
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'overview') return new Promise(() => {}); // never resolves → stays loading
      return layoutReply();
    });
    const { container } = render(<OverviewDashboard refreshKey={0} onChanged={noop} />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('ERROR: a backend ok:false surfaces role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'overview') {
        return fail
          ? Promise.resolve({ data: { ok: false, error: 'STATE unavailable' } })
          : reply({ tiles: ['steps'], cards: [], totalReadings: 0, hasData: false });
      }
      return layoutReply();
    });
    const { container, getByText } = render(<OverviewDashboard refreshKey={0} onChanged={noop} />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/STATE unavailable/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'overview').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'overview').length).toBeGreaterThan(before));
    // After a successful retry with an empty ledger → the empty state.
    await waitFor(() => expect(getByText(/No data yet/i)).toBeInTheDocument());
  });

  it('ERROR: a thrown (network) overload also surfaces role=alert, never a silent blank', async () => {
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'overview') return Promise.reject(new Error('network exploded'));
      return layoutReply();
    });
    const { container, getByText, queryByText } = render(<OverviewDashboard refreshKey={0} onChanged={noop} />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/network exploded/i)).toBeInTheDocument();
    // The failure must NOT be swallowed into the empty "No data yet" page.
    expect(queryByText(/No data yet/i)).toBeNull();
  });

  it('EMPTY: an empty ledger (hasData:false) shows the honest "No data yet" CTA', async () => {
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'overview') return reply({ tiles: ['steps'], cards: [{ metric: 'steps', label: 'Steps', unit: 'steps', value: null, readings: 0 }], totalReadings: 0, hasData: false });
      return layoutReply();
    });
    const { getByText } = render(<OverviewDashboard refreshKey={0} onChanged={noop} />);
    await waitFor(() => expect(getByText(/No data yet/i)).toBeInTheDocument());
  });

  it('POPULATED: a real ledger renders the metric tiles with accurate values', async () => {
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'overview') {
        return reply({
          tiles: ['steps', 'mood'],
          cards: [
            { metric: 'steps', label: 'Steps', unit: 'steps', value: 8000, readings: 2 },
            { metric: 'mood', label: 'Mood', unit: '/5', value: 4, readings: 1 },
          ],
          totalReadings: 3,
          hasData: true,
        });
      }
      return layoutReply();
    });
    const { getByText } = render(<OverviewDashboard refreshKey={0} onChanged={noop} />);
    await waitFor(() => expect(getByText('8000steps')).toBeInTheDocument());
    expect(getByText('4/5')).toBeInTheDocument();
    expect(getByText(/3 total readings/i)).toBeInTheDocument();
  });

  it('drives the REAL self.overview + self.layout macros (not a fabricated channel)', async () => {
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'overview') return reply({ tiles: [], cards: [], totalReadings: 0, hasData: false });
      return layoutReply();
    });
    render(<OverviewDashboard refreshKey={0} onChanged={noop} />);
    await waitFor(() =>
      expect(lensRun.mock.calls.some((c) => c[0] === 'self' && c[1] === 'overview')).toBe(true));
    expect(lensRun.mock.calls.some((c) => c[0] === 'self' && c[1] === 'layout')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-substrate tabs — every caller must hit a REAL macro, and tabs with no
// substrate must make NO backend call (honest cross-lens CTA instead).
// ─────────────────────────────────────────────────────────────────────────────

// Heavy page deps → inert stubs so the test stays on the page's own tab bodies.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/self/SelfFeed', () => ({ SelfFeed: () => null }));
vi.mock('@/components/self/LogMetricForm', () => ({ LogMetricForm: () => null }));
// NOTE: OverviewDashboard is intentionally NOT mocked — block 1 tests the real
// component. On the page it renders on the default Overview tab and calls
// lensRun('self','overview'/'layout'), which the lensRun mock answers below.
vi.mock('@/components/self/TrendPanel', () => ({ TrendPanel: () => null }));
vi.mock('@/components/self/CorrelationPanel', () => ({ CorrelationPanel: () => null }));
vi.mock('@/components/self/GoalsPanel', () => ({ GoalsPanel: () => null }));
vi.mock('@/components/self/DigestPanel', () => ({ DigestPanel: () => null }));
vi.mock('@/components/self/StreaksPanel', () => ({ StreaksPanel: () => null }));
vi.mock('@/components/self/ImportPanel', () => ({ ImportPanel: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) =>
    React.createElement('div', props, (props as { children?: React.ReactNode }).children) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SelfPage from '@/app/lenses/self/page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(SelfPage)),
  );
  return utils;
}

// Default cross-substrate channel: whoami + the two REAL repointed macros.
function baseDomain(domain: string, action: string) {
  if (domain === 'auth' && action === 'whoami') return Promise.resolve({ data: { result: { userId: 'u1' } } });
  if (domain === 'fitness' && action === 'activity-summary') return Promise.resolve({ data: { result: { days: [], source: 'empty', notes: 'No activity logged.' } } });
  if (domain === 'affect' && action === 'trends') return Promise.resolve({ data: { result: { hasData: false } } });
  return Promise.resolve({ data: { result: {} } });
}

describe('self lens — cross-substrate tabs hit REAL macros (no dead callers)', () => {
  beforeEach(() => {
    runDomain.mockReset();
    runDomain.mockImplementation(baseDomain);
    // The default Overview tab mounts the real OverviewDashboard → lensRun.
    lensRun.mockReset();
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'layout') return layoutReply();
      return reply({ tiles: [], cards: [], totalReadings: 0, hasData: false });
    });
    // achievements REST fetch (not under test here) → benign empty.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ achievements: [] }) })));
  });

  it('the Fitness tab calls the REAL fitness.activity-summary macro and renders its fields', async () => {
    runDomain.mockImplementation((domain: string, action: string) => {
      if (domain === 'fitness' && action === 'activity-summary') {
        return Promise.resolve({ data: { result: {
          days: [
            { date: '2026-06-26', steps: 5000, activeMinutes: 30 },
            { date: '2026-06-27', steps: 7000, activeMinutes: 45 },
          ],
          source: 'device',
        } } });
      }
      return baseDomain(domain, action);
    });
    const { getByText } = renderPage();
    fireEvent.click(getByText('Fitness'));
    await waitFor(() =>
      expect(runDomain.mock.calls.some((c) => c[0] === 'fitness' && c[1] === 'activity-summary')).toBe(true));
    // Renders real aggregated fields (12000 total steps, 2 days).
    await waitFor(() => expect(getByText('12000')).toBeInTheDocument());
    expect(getByText(/sourced from device/i)).toBeInTheDocument();
    // PROOF: the old phantom fitness.status / fitness.metrics is never called.
    expect(runDomain.mock.calls.some((c) => c[1] === 'status' || c[1] === 'metrics')).toBe(false);
  });

  it('the Mood tab calls the REAL affect.trends macro and renders its fields', async () => {
    runDomain.mockImplementation((domain: string, action: string) => {
      if (domain === 'affect' && action === 'trends') {
        return Promise.resolve({ data: { result: {
          hasData: true,
          overallAvg: 3.8,
          entryCount: 12,
          dayOfWeek: [
            { label: 'Mon', avgMood: 3.0, count: 2 },
            { label: 'Sat', avgMood: 4.5, count: 3 },
          ],
        } } });
      }
      return baseDomain(domain, action);
    });
    const { getByText } = renderPage();
    fireEvent.click(getByText('Mood'));
    await waitFor(() =>
      expect(runDomain.mock.calls.some((c) => c[0] === 'affect' && c[1] === 'trends')).toBe(true));
    await waitFor(() => expect(getByText('3.8')).toBeInTheDocument());  // overallAvg
    expect(getByText('12')).toBeInTheDocument();                        // entryCount
    expect(getByText('Sat')).toBeInTheDocument();                       // best day
    // PROOF: the old phantom affect.status / mental_health.status is never called.
    expect(runDomain.mock.calls.some((c) => c[0] === 'mental_health')).toBe(false);
    expect(runDomain.mock.calls.some((c) => c[0] === 'affect' && c[1] === 'status')).toBe(false);
  });

  it('the Sleep tab makes NO backend call — an honest cross-lens CTA', async () => {
    const { getByText, getByRole } = renderPage();
    fireEvent.click(getByText('Sleep'));
    await waitFor(() => expect(getByText(/Log sleep on Overview/i)).toBeInTheDocument());
    // No sleep / phantom macro was ever called.
    expect(runDomain.mock.calls.some((c) => c[0] === 'sleep')).toBe(false);
    // The CTA links to a real lens.
    expect(getByRole('link', { name: /Wellness lens/i }).getAttribute('href')).toBe('/lenses/wellness');
  });

  it('the Journal tab makes NO backend call — an honest cross-lens CTA', async () => {
    const { getByText, getByRole } = renderPage();
    fireEvent.click(getByText('Journal'));
    await waitFor(() => expect(getByText(/Open the Mental Health lens/i)).toBeInTheDocument());
    // No journal / atlas phantom macro was ever called.
    expect(runDomain.mock.calls.some((c) => c[0] === 'journal')).toBe(false);
    expect(runDomain.mock.calls.some((c) => c[0] === 'atlas')).toBe(false);
    expect(getByRole('link', { name: /Open the Mental Health lens/i }).getAttribute('href')).toBe('/lenses/mental-health');
  });
});
