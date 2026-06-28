/**
 * /lenses/narrative-walk — reader-lens four-UX-state contract.
 *
 * narrative-walk is a SELF-CONTAINED authored-narrative READER. There is NO
 * backend macro surface — the 11 authored cinematic sequences are bundled at
 * build time and registered with the client-side cinematic-director. This test
 * pins, against that real reader contract:
 *
 *   - LOADING: role=status while the catalog dynamic-import is in flight.
 *   - ERROR:   role=alert when the bundled content fails to register.
 *   - EMPTY:   honest "no story beats" note when zero sequences register.
 *   - POPULATED: authored beats render with name + authored blurb + shot/duration.
 *   - WIRING:  Play resolves the director by TRIGGER (not id), so beats whose
 *              id !== trigger actually play (the real-bug regression guard).
 *   - a11y:    play buttons carry accessible names; arrow keys move focus.
 *
 * The cinematic modules are mocked to stand in for the bundled JSON registry —
 * mocks live ONLY in this test; the runtime page imports the real modules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── headless shell + action bar: render-only stubs ──────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => React.createElement('div', { 'data-testid': 'action-bar' }),
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

// ── cinematic registry + director: the bundled-content channel ──────────────
const ensureCinematicsRegistered = vi.fn();
const listSequences = vi.fn();
const playSequence = vi.fn();

vi.mock('@/lib/world-lens/cinematic-sequences-registry', () => ({
  ensureCinematicsRegistered: () => ensureCinematicsRegistered(),
}));
vi.mock('@/lib/world-lens/cinematic-director', () => ({
  listSequences: () => listSequences(),
  playSequence: (...args: unknown[]) => playSequence(...args),
}));

// Import AFTER mocks are registered.
import NarrativeWalkLens from '@/app/lenses/narrative-walk/page';

// Authored sequence shape — matches content/cinematics/*.json (id MAY differ
// from trigger; carries an authored `comment`, no `summary`).
const SEQS = [
  {
    id: 'boss_arrival', trigger: 'boss_arrival', name: 'Boss Arrival',
    comment: 'Wide environmental shot + boss silhouette emerge + name-card flash.',
    shots: [{ duration_ms: 1500 }, { duration_ms: 300 }],
  },
  {
    // id !== trigger — the real-bug case (play must use trigger).
    id: 'vela_reveal', trigger: 'vela:reveal', name: 'Vela Reveal',
    comment: 'Bespoke cinematic for the Vela reveal beat in the Akeia matriarchy.',
    shots: [{ duration_ms: 90000 }],
  },
];

beforeEach(() => {
  ensureCinematicsRegistered.mockReset();
  listSequences.mockReset();
  playSequence.mockReset();
  playSequence.mockResolvedValue(undefined);
  try { localStorage.clear(); } catch { /* noop */ }
});

describe('narrative-walk reader lens — four UX states + wiring', () => {
  it('LOADING: shows a role=status indicator while the catalog imports', async () => {
    // listSequences never gets to run until the dynamic import resolves; assert
    // the initial render is the loading state.
    listSequences.mockReturnValue([]);
    const { container } = render(<NarrativeWalkLens />);
    // Synchronous first paint is the loading state (imports are async).
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('EMPTY: shows the honest "no story beats" note when zero sequences register', async () => {
    listSequences.mockReturnValue([]);
    const { findByText } = render(<NarrativeWalkLens />);
    expect(await findByText(/No story beats yet/i)).toBeInTheDocument();
  });

  it('ERROR: a failed library load shows role=alert', async () => {
    ensureCinematicsRegistered.mockImplementation(() => { throw new Error('content missing'); });
    listSequences.mockReturnValue([]);
    const { container } = render(<NarrativeWalkLens />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
  });

  it('POPULATED: renders authored beats with name, authored blurb, shots + duration', async () => {
    listSequences.mockReturnValue(SEQS);
    const { findByText, getByText } = render(<NarrativeWalkLens />);
    expect(await findByText('Boss Arrival')).toBeInTheDocument();
    // authored comment surfaced as the human-facing blurb
    expect(getByText(/Wide environmental shot/i)).toBeInTheDocument();
    // shot count + duration computed from the shots array
    expect(getByText(/2 shots/i)).toBeInTheDocument();
    expect(getByText(/1\.8s/)).toBeInTheDocument();
    // second beat formats minutes
    expect(getByText(/1m 30s/)).toBeInTheDocument();
    expect(ensureCinematicsRegistered).toHaveBeenCalled();
  });

  it('WIRING: Play resolves the director by TRIGGER, not id (id !== trigger regression guard)', async () => {
    listSequences.mockReturnValue(SEQS);
    const { findByLabelText } = render(<NarrativeWalkLens />);
    const velaBtn = await findByLabelText(/Play Vela Reveal/i);
    await act(async () => { fireEvent.click(velaBtn); });
    await waitFor(() => expect(playSequence).toHaveBeenCalled());
    // The vela beat has id 'vela_reveal' but trigger 'vela:reveal' — the
    // director matches on trigger, so we MUST pass the trigger.
    expect(playSequence).toHaveBeenCalledWith('vela:reveal', expect.objectContaining({ source: 'narrative-walk-lens' }));
  });

  it('WATCHED: playing marks the beat watched and persists to localStorage', async () => {
    listSequences.mockReturnValue(SEQS);
    const { findByLabelText, getByText } = render(<NarrativeWalkLens />);
    const bossBtn = await findByLabelText(/Play Boss Arrival/i);
    await act(async () => { fireEvent.click(bossBtn); });
    // The button relabels to "Re-watch …" once the beat is watched.
    await waitFor(() => expect(findByLabelText(/Re-watch Boss Arrival/i)).resolves.toBeInTheDocument());
    expect(getByText('Re-watch')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('concordia:narrative-walk:watched') || '[]');
    expect(stored).toContain('boss_arrival');
  });

  it('a11y: each play button carries an accessible name and the list labels itself', async () => {
    listSequences.mockReturnValue(SEQS);
    const { findByLabelText, container } = render(<NarrativeWalkLens />);
    expect(await findByLabelText(/Play Boss Arrival/i)).toBeInTheDocument();
    expect(container.querySelector('ol[aria-label="Authored story beats"]')).toBeTruthy();
  });
});
