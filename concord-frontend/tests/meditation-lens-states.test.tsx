/**
 * /lenses/meditation — four-UX-state contract.
 *
 * Pins that the Meditation lens renders genuine loading / error (with a
 * working Retry) / empty / populated states for its "Your practice" surface,
 * which is driven by the REAL STATE-backed `meditation.streak` macro through
 * the page's callMacro → apiHelpers.lens.runDomain channel — plus a11y
 * (loading is role=status, error is role=alert with a working Retry).
 *
 * No fabricated data: each state is driven by a controllable mock of the page's
 * single macro channel (apiHelpers.lens.runDomain), in exactly the envelope the
 * server returns ({ data: { ok, result } }). The headless LensShell, the heavy
 * lens-primitive cards, the studio panels, and the artifact hook are render-only
 * stubs so the test stays on the page's own practice-summary state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── the page's macro channel (callMacro → apiHelpers.lens.runDomain) ─────────
const runDomain = vi.fn();
const apiPost = vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } }));
const apiGet = vi.fn(() => Promise.resolve({ data: { ok: true } }));
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));

// ── artifact substrate hook: no artifacts (we drive practice via the macro) ──
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], refetch: vi.fn() }),
}));

// ── headless shell + nav/command/heavy children: render-only stubs ───────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/meditation/MeditationStudio', () => ({ MeditationStudio: () => null }));
vi.mock('@/components/meditation/BreathingVisual', () => ({ BreathingVisual: () => null }));
vi.mock('@/components/meditation/SoundscapePlayer', () => ({ SoundscapePlayer: () => null }));
vi.mock('@/components/meditation/CoursesPanel', () => ({ CoursesPanel: () => null }));
vi.mock('@/components/meditation/RemindersPanel', () => ({ RemindersPanel: () => null }));
vi.mock('@/components/meditation/InsightsPanel', () => ({ InsightsPanel: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) =>
    React.createElement('div', props, (props as { children?: React.ReactNode }).children) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

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
import MeditationPage from '@/app/lenses/meditation/page';

// macro envelope helper — exactly the { data: { ok, result } } the server returns.
function macroReply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

// Default macro routing: pickTrack + dailyPrompt resolve harmlessly; tests
// override `streak` to drive the practice-summary state machine.
function baseRunDomain(_domain: string, action: string) {
  if (action === 'pickTrack') {
    return macroReply({ trackId: 't1', title: 'Single-pointed attention', narrator: 'Tara Brach', durationMinutes: 10, goal: 'focus', vibe: 'steady' });
  }
  if (action === 'dailyPrompt') return macroReply({ date: '2026-06-27', prompt: 'Where is your attention drawn first?' });
  if (action === 'streak') return macroReply({ currentStreak: 0, totalSessions: 0, totalMinutes: 0 });
  return macroReply({});
}

beforeEach(() => {
  runDomain.mockReset();
  apiGet.mockReset(); apiGet.mockImplementation(() => Promise.resolve({ data: { ok: true } }));
  apiPost.mockReset(); apiPost.mockImplementation(() => Promise.resolve({ data: { ok: true, result: {} } }));
  window.localStorage.clear();
});

describe('meditation lens — four UX states (Your practice surface)', () => {
  it('LOADING: shows a role=status indicator while the practice summary is in flight', async () => {
    runDomain.mockImplementation((domain: string, action: string) => {
      if (action === 'streak') return new Promise(() => {}); // never resolves → stays loading
      return baseRunDomain(domain, action);
    });
    const { container } = render(<MeditationPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('ERROR: a failed streak load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    runDomain.mockImplementation((domain: string, action: string) => {
      if (action === 'streak') {
        return fail ? Promise.reject(new Error('practice exploded')) : macroReply({ currentStreak: 0, totalSessions: 0, totalMinutes: 0 });
      }
      return baseRunDomain(domain, action);
    });
    const { container, getByText } = render(<MeditationPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/practice exploded/i)).toBeInTheDocument();

    const before = runDomain.mock.calls.filter((c) => c[1] === 'streak').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(runDomain.mock.calls.filter((c) => c[1] === 'streak').length).toBeGreaterThan(before));
    // After a successful retry with zero sessions → the empty state.
    await waitFor(() => expect(getByText(/No sessions yet/i)).toBeInTheDocument());
  });

  it('EMPTY: a zero-session ledger shows the honest "No sessions yet" CTA', async () => {
    runDomain.mockImplementation(baseRunDomain);
    const { getByText } = render(<MeditationPage />);
    await waitFor(() => expect(getByText(/No sessions yet/i)).toBeInTheDocument());
  });

  it('POPULATED: a real streak renders the practice stat grid with accurate values', async () => {
    runDomain.mockImplementation((domain: string, action: string) => {
      if (action === 'streak') return macroReply({ currentStreak: 4, totalSessions: 12, totalMinutes: 95 });
      return baseRunDomain(domain, action);
    });
    const { getByText, getAllByText } = render(<MeditationPage />);
    await waitFor(() => expect(getByText('current streak')).toBeInTheDocument());
    expect(getByText('sessions')).toBeInTheDocument();
    expect(getByText('12')).toBeInTheDocument();   // totalSessions
    expect(getByText('95')).toBeInTheDocument();   // totalMinutes
    // current streak value 4 appears (header + grid) — at least once.
    expect(getAllByText('4').length).toBeGreaterThanOrEqual(1);
  });

  it('drives the REAL meditation.streak macro (not a fabricated channel)', async () => {
    runDomain.mockImplementation(baseRunDomain);
    render(<MeditationPage />);
    await waitFor(() =>
      expect(runDomain.mock.calls.some((c) => c[0] === 'meditation' && c[1] === 'streak')).toBe(true));
  });
});
